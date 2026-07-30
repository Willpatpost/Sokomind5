import {
  SolverCancelledError,
} from "./cancellation.ts";
import type {
  SolverMetadata,
  SolverProgress,
  SolverRequest,
  SolverResult,
} from "./contracts.ts";
import {
  isSolverWorkerEvent,
  SOLVER_WORKER_PROTOCOL_VERSION,
  type SerializedSolverError,
  type SolverWorkerCommand,
  type SolverWorkerEvent,
} from "./protocol.ts";
import { assertValidSolverRequest } from "./validation.ts";
import { assertVerifiedSolverSolution } from "./verification.ts";

export interface SolverClientMessageEvent {
  readonly data: unknown;
}

export type SolverClientMessageListener = (
  event: SolverClientMessageEvent,
) => void;

export interface SolverWorkerClientTransport {
  postMessage(message: SolverWorkerCommand): void;
  addEventListener(
    type: "message",
    listener: SolverClientMessageListener,
  ): void;
  removeEventListener(
    type: "message",
    listener: SolverClientMessageListener,
  ): void;
  terminate?(): void;
}

export interface SolverWorkerClientOptions {
  readonly createJobId?: () => string;
}

export interface SolverRunOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: SolverProgress) => void;
}

export interface SolverRunHandle {
  readonly jobId: string;
  readonly result: Promise<SolverResult>;
  cancel(reason?: string): void;
}

export class SolverClientDisposedError extends Error {
  constructor() {
    super("Solver worker client has been disposed.");
    this.name = "SolverClientDisposedError";
  }
}

export class SolverRunSupersededError extends SolverCancelledError {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Solver job "${jobId}" was superseded by a newer run.`);
    this.name = "SolverRunSupersededError";
    this.jobId = jobId;
  }
}

export class SolverProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverProtocolError";
  }
}

export class RemoteSolverError extends Error {
  readonly code?: string;
  readonly remoteStack?: string;

  constructor(error: SerializedSolverError) {
    super(error.message);
    this.name = error.name || "RemoteSolverError";
    if (error.code !== undefined) this.code = error.code;
    if (error.stack !== undefined) this.remoteStack = error.stack;
  }
}

interface ActiveClientRun {
  readonly jobId: string;
  readonly request: SolverRequest;
  readonly options: SolverRunOptions;
  readonly resolve: (result: SolverResult) => void;
  readonly reject: (error: unknown) => void;
  readonly detachSignal: () => void;
}

interface DiscoveryPromise {
  readonly resolve: (metadata: readonly SolverMetadata[]) => void;
  readonly reject: (error: unknown) => void;
}

let nextJobNumber = 1;

function defaultJobId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  const id = `solver-${Date.now().toString(36)}-${nextJobNumber.toString(36)}`;
  nextJobNumber += 1;
  return id;
}

/**
 * Main-thread controller for one active worker job. Starting a new run
 * supersedes the previous one, and all late events from stale job ids are
 * ignored.
 */
export class SolverWorkerClient {
  readonly #transport: SolverWorkerClientTransport;
  readonly #createJobId: () => string;
  readonly #onMessage: SolverClientMessageListener;
  readonly #discoveries = new Set<DiscoveryPromise>();
  #active?: ActiveClientRun;
  #disposed = false;

  constructor(
    transport: SolverWorkerClientTransport,
    options: SolverWorkerClientOptions = {},
  ) {
    this.#transport = transport;
    this.#createJobId = options.createJobId ?? defaultJobId;
    this.#onMessage = ({ data }) => {
      this.#handleMessage(data);
    };
    this.#transport.addEventListener("message", this.#onMessage);
  }

  get activeJobId(): string | undefined {
    return this.#active?.jobId;
  }

  discover(): Promise<readonly SolverMetadata[]> {
    this.#assertActiveClient();
    let discovery!: DiscoveryPromise;
    const promise = new Promise<readonly SolverMetadata[]>(
      (resolve, reject) => {
        discovery = { resolve, reject };
        this.#discoveries.add(discovery);
      },
    );
    try {
      this.#post({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "solver/discover",
      });
    } catch (error) {
      this.#discoveries.delete(discovery);
      discovery.reject(error);
    }
    return promise;
  }

  run(
    solverId: string,
    request: SolverRequest,
    options: SolverRunOptions = {},
  ): SolverRunHandle {
    this.#assertActiveClient();
    if (typeof solverId !== "string" || !solverId.trim()) {
      throw new TypeError("Solver id must be a non-empty string.");
    }
    assertValidSolverRequest(request);

    if (this.#active) {
      const previous = this.#active;
      try {
        this.#post({
          protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
          type: "solver/cancel",
          jobId: previous.jobId,
          reason: "Superseded by a newer solver run",
        });
      } catch {
        // The previous local promise must still be settled when transport fails.
      }
      this.#settleActive(previous, new SolverRunSupersededError(previous.jobId));
    }

    const jobId = this.#createJobId();
    if (typeof jobId !== "string" || !jobId.trim()) {
      throw new TypeError("Solver job id factory returned an invalid id.");
    }

    let resolveResult!: (result: SolverResult) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<SolverResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const onAbort = () => {
      this.cancel(
        typeof options.signal?.reason === "string"
          ? options.signal.reason
          : undefined,
      );
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const active: ActiveClientRun = {
      jobId,
      request,
      options,
      resolve: resolveResult,
      reject: rejectResult,
      detachSignal: () => {
        options.signal?.removeEventListener("abort", onAbort);
      },
    };
    this.#active = active;

    try {
      this.#post({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "solver/run",
        jobId,
        solverId,
        request,
      });
      if (options.signal?.aborted) onAbort();
    } catch (error) {
      this.#settleActive(active, error);
    }

    return Object.freeze({
      jobId,
      result,
      cancel: (reason?: string) => {
        if (this.#active === active) this.cancel(reason);
      },
    });
  }

  cancel(reason?: string): void {
    const active = this.#active;
    if (!active || this.#disposed) return;
    try {
      this.#post({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "solver/cancel",
        jobId: active.jobId,
        ...(reason === undefined ? {} : { reason }),
      });
    } catch (error) {
      this.#settleActive(active, error);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#transport.removeEventListener("message", this.#onMessage);
    const error = new SolverClientDisposedError();
    if (this.#active) {
      const active = this.#active;
      try {
        this.#transport.postMessage({
          protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
          type: "solver/cancel",
          jobId: active.jobId,
          reason: error.message,
        });
      } catch {
        // Local cleanup must not depend on a live worker transport.
      }
      this.#settleActive(active, error);
    }
    this.#rejectDiscoveries(error);
    this.#transport.terminate?.();
  }

  #assertActiveClient(): void {
    if (this.#disposed) throw new SolverClientDisposedError();
  }

  #post(message: SolverWorkerCommand): void {
    if (this.#disposed) throw new SolverClientDisposedError();
    this.#transport.postMessage(message);
  }

  #handleMessage(value: unknown): void {
    if (this.#disposed) return;
    if (!isSolverWorkerEvent(value)) {
      const error = new SolverProtocolError(
        "Worker emitted an invalid solver protocol event.",
      );
      if (this.#active) {
        const active = this.#active;
        try {
          this.#post({
            protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
            type: "solver/cancel",
            jobId: active.jobId,
            reason: error.message,
          });
        } catch {
          // The malformed boundary event remains the primary failure.
        }
        this.#settleActive(active, error);
      }
      this.#rejectDiscoveries(error);
      return;
    }

    switch (value.type) {
      case "solver/ready":
        for (const discovery of this.#discoveries) {
          discovery.resolve(value.solvers);
        }
        this.#discoveries.clear();
        break;
      case "solver/progress":
        this.#handleProgress(value);
        break;
      case "solver/result":
        this.#handleResult(value);
        break;
      case "solver/failure":
        this.#handleFailure(value);
        break;
    }
  }

  #handleProgress(
    event: Extract<SolverWorkerEvent, { type: "solver/progress" }>,
  ): void {
    const active = this.#active;
    if (!active || active.jobId !== event.jobId) return;
    try {
      active.options.onProgress?.(event.progress);
    } catch (error) {
      this.cancel("Progress callback failed");
      this.#settleActive(active, error);
    }
  }

  #handleResult(
    event: Extract<SolverWorkerEvent, { type: "solver/result" }>,
  ): void {
    const active = this.#active;
    if (!active || active.jobId !== event.jobId) return;
    try {
      if (event.result.status === "solved") {
        assertVerifiedSolverSolution(active.request, event.result.solution);
      }
      active.detachSignal();
      this.#active = undefined;
      active.resolve(event.result);
    } catch (error) {
      this.#settleActive(active, error);
    }
  }

  #handleFailure(
    event: Extract<SolverWorkerEvent, { type: "solver/failure" }>,
  ): void {
    const error = new RemoteSolverError(event.error);
    if (event.jobId === undefined) {
      if (this.#active) this.#settleActive(this.#active, error);
      this.#rejectDiscoveries(error);
      return;
    }
    const active = this.#active;
    if (!active || active.jobId !== event.jobId) return;
    this.#settleActive(active, error);
  }

  #settleActive(active: ActiveClientRun, error: unknown): void {
    if (this.#active !== active) return;
    active.detachSignal();
    this.#active = undefined;
    active.reject(error);
  }

  #rejectDiscoveries(error: unknown): void {
    for (const discovery of this.#discoveries) discovery.reject(error);
    this.#discoveries.clear();
  }
}

/**
 * Adapts the browser Worker API without leaking DOM event types into the
 * portable controller.
 */
export function createSolverWorkerClient(
  worker: Worker,
  options: SolverWorkerClientOptions = {},
): SolverWorkerClient {
  const listeners = new Map<
    SolverClientMessageListener,
    (event: MessageEvent<unknown>) => void
  >();
  return new SolverWorkerClient(
    {
      postMessage(message) {
        worker.postMessage(message);
      },
      addEventListener(_type, listener) {
        const wrapped = (event: MessageEvent<unknown>) => listener(event);
        listeners.set(listener, wrapped);
        worker.addEventListener("message", wrapped);
      },
      removeEventListener(_type, listener) {
        const wrapped = listeners.get(listener);
        if (!wrapped) return;
        listeners.delete(listener);
        worker.removeEventListener("message", wrapped);
      },
      terminate() {
        worker.terminate();
      },
    },
    options,
  );
}
