import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GameSession } from "@/src/core";
import {
  createSolverWorkerClient,
  type SolutionStep,
  type SolverMetadata,
  type SolverProgress,
  type SolverResult,
  type SolverRunHandle,
  type SolverWorkerClient,
} from "@/src/solver";
import { phaseLabel, resultSummary } from "./solver-format";

const MAX_LOG_ENTRIES = 80;
const PROGRESS_LOG_INTERVAL_MS = 1_000;
const WORKER_STARTUP_TIMEOUT_MS = 5_000;
const MEBIBYTE = 1024 * 1024;

export const TIME_LIMIT_OPTIONS = Object.freeze([
  { value: 5_000, label: "5 seconds" },
  { value: 15_000, label: "15 seconds" },
  { value: 30_000, label: "30 seconds" },
  { value: 60_000, label: "1 minute" },
  { value: 120_000, label: "2 minutes" },
  { value: 0, label: "No time limit" },
] as const);

export const MEMORY_LIMIT_OPTIONS = Object.freeze([
  { value: 0, label: "Automatic" },
  { value: 384, label: "Low memory (384 MiB)" },
  { value: 768, label: "Desktop (768 MiB)" },
  { value: 1_536, label: "Large desktop (1.5 GiB)" },
] as const);

export interface SolverRunFingerprint {
  readonly puzzleId: string;
  readonly actionLog: string;
}

export type SolverUiPhase =
  | "loading"
  | "ready"
  | "running"
  | "cancelling"
  | "solved"
  | "unsolved"
  | "cancelled"
  | "error";

export interface SolverLogEntry {
  readonly id: number;
  readonly elapsedMs: number;
  readonly message: string;
  readonly tone: "info" | "success" | "warning" | "error";
}

interface UseSolverControllerOptions {
  readonly open: boolean;
  readonly session: GameSession;
}

function fingerprintFor(session: GameSession): SolverRunFingerprint {
  return Object.freeze({
    puzzleId: session.puzzle.id,
    actionLog: session.actionLog,
  });
}

function fingerprintKey(fingerprint: SolverRunFingerprint): string {
  return `${fingerprint.puzzleId}\u0000${fingerprint.actionLog}`;
}

function sessionKey(session: GameSession): string {
  return fingerprintKey(fingerprintFor(session));
}

function isAStar(metadata: SolverMetadata): boolean {
  return (
    /(^|-)a-?star($|-)/i.test(metadata.id) ||
    /\ba\s*\*/i.test(metadata.displayName) ||
    /\ba[\s-]*star\b/i.test(metadata.displayName)
  );
}

function automaticMemoryLimitBytes(): number {
  const memoryGb = (
    navigator as Navigator & { readonly deviceMemory?: number }
  ).deviceMemory;
  if (memoryGb === undefined) return 768 * MEBIBYTE;
  if (memoryGb <= 4) return 384 * MEBIBYTE;
  if (memoryGb <= 8) return 768 * MEBIBYTE;
  return 1_536 * MEBIBYTE;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The solver worker stopped unexpectedly.";
}

function progressLogMessage(progress: SolverProgress): string {
  const detail = progress.detail?.trim();
  const message = detail || phaseLabel(progress.phase);
  const counters = [
    progress.expandedStates === undefined
      ? null
      : `${progress.expandedStates.toLocaleString()} expanded`,
    progress.generatedStates === undefined
      ? null
      : `${progress.generatedStates.toLocaleString()} generated`,
    progress.frontierSize === undefined
      ? null
      : `${progress.frontierSize.toLocaleString()} queued`,
  ].filter((value): value is string => value !== null);
  return counters.length > 0 ? `${message} | ${counters.join(" | ")}` : message;
}

export function useSolverController({
  open,
  session,
}: UseSolverControllerOptions) {
  const [workerGeneration, setWorkerGeneration] = useState(0);
  const [solvers, setSolvers] = useState<readonly SolverMetadata[]>([]);
  const [selectedSolverId, setSelectedSolverId] = useState("");
  const [timeLimitMs, setTimeLimitMs] = useState(60_000);
  const [memoryLimitMiB, setMemoryLimitMiB] = useState(0);
  const [uiPhase, setUiPhase] = useState<SolverUiPhase>("loading");
  const [progress, setProgress] = useState<SolverProgress | null>(null);
  const [result, setResult] = useState<SolverResult | null>(null);
  const [runFingerprint, setRunFingerprint] =
    useState<SolverRunFingerprint | null>(null);
  const [runSolverId, setRunSolverId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] =
    useState("Connecting to the solver worker.");
  const [logEntries, setLogEntries] = useState<readonly SolverLogEntry[]>(() => [
    Object.freeze({
      id: 1,
      elapsedMs: 0,
      message: "Discovering available search algorithms.",
      tone: "info" as const,
    }),
  ]);
  const [liveElapsedMs, setLiveElapsedMs] = useState(0);

  const clientRef = useRef<SolverWorkerClient | null>(null);
  const runRef = useRef<SolverRunHandle | null>(null);
  const elapsedRef = useRef(0);
  const runTokenRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const currentSessionRef = useRef(session);
  const previousSessionKeyRef = useRef(sessionKey(session));
  const previousOpenRef = useRef(open);
  const nextLogIdRef = useRef(2);
  const lastProgressLogRef = useRef<{
    elapsedMs: number;
    phase?: SolverProgress["phase"];
  }>({ elapsedMs: Number.NEGATIVE_INFINITY });

  useEffect(() => {
    currentSessionRef.current = session;
  }, [session]);

  const appendLog = useCallback(
    (
      message: string,
      tone: SolverLogEntry["tone"] = "info",
      elapsedMs = 0,
    ) => {
      const entry: SolverLogEntry = Object.freeze({
        id: nextLogIdRef.current++,
        elapsedMs: Math.max(0, elapsedMs),
        message,
        tone,
      });
      setLogEntries((current) => {
        const next = [...current, entry];
        return next.length > MAX_LOG_ENTRIES
          ? next.slice(next.length - MAX_LOG_ENTRIES)
          : next;
      });
    },
    [],
  );

  const selectedSolver = useMemo(
    () => solvers.find(({ id }) => id === selectedSolverId),
    [selectedSolverId, solvers],
  );

  useEffect(() => {
    let active = true;
    let failed = false;
    let startupTimer = 0;
    let client: SolverWorkerClient | null = null;
    let worker: Worker | null = null;

    const fail = (reason: unknown) => {
      console.warn("Sokomind: solver worker failure", reason);
      if (!active || failed) return;
      failed = true;
      window.clearTimeout(startupTimer);
      runTokenRef.current += 1;
      runRef.current = null;
      const message = errorMessage(reason);
      setUiPhase("error");
      setError(message);
      setStatusMessage(`Solver unavailable: ${message}`);
      appendLog(message, "error");
      client?.dispose();
      if (clientRef.current === client) clientRef.current = null;
    };

    try {
      worker = new Worker(
        new URL("../../solver/solver.worker.ts", import.meta.url),
        { type: "module", name: "sokomind-search" },
      );
      const onWorkerError = (event: ErrorEvent) => {
        fail(event.message || "The solver worker failed to start.");
      };
      const onMessageError = () => {
        fail("The solver worker returned an unreadable message.");
      };
      worker.addEventListener("error", onWorkerError);
      worker.addEventListener("messageerror", onMessageError);

      client = createSolverWorkerClient(worker);
      clientRef.current = client;
      startupTimer = window.setTimeout(() => {
        fail("The solver worker did not respond within 5 seconds.");
      }, WORKER_STARTUP_TIMEOUT_MS);

      void client.discover().then(
        (metadata) => {
          if (!active || failed) return;
          window.clearTimeout(startupTimer);
          if (metadata.length === 0) {
            fail("No search algorithms were registered in the worker.");
            return;
          }

          const discovered = Object.freeze([...metadata]);
          setSolvers(discovered);
          setSelectedSolverId((current) => {
            if (discovered.some(({ id }) => id === current)) return current;
            return (
              discovered.find(({ id }) => id === "sokomind-solver")?.id ??
              discovered.find(isAStar)?.id ??
              discovered[0]?.id ??
              ""
            );
          });
          setUiPhase("ready");
          setStatusMessage(
            `${metadata.length} search ${metadata.length === 1 ? "algorithm is" : "algorithms are"} ready.`,
          );
          appendLog(
            `Ready with ${metadata.length} search ${metadata.length === 1 ? "algorithm" : "algorithms"}.`,
            "success",
          );
        },
        fail,
      );

      return () => {
        active = false;
        window.clearTimeout(startupTimer);
        worker?.removeEventListener("error", onWorkerError);
        worker?.removeEventListener("messageerror", onMessageError);
        runTokenRef.current += 1;
        runRef.current?.cancel("Solver controller disposed");
        runRef.current = null;
        client?.dispose();
        if (clientRef.current === client) clientRef.current = null;
      };
    } catch (caught) {
      console.warn("Sokomind: solver worker construction failed", caught);
      fail(caught);
      return () => {
        active = false;
        window.clearTimeout(startupTimer);
        client?.dispose();
        if (clientRef.current === client) clientRef.current = null;
      };
    }
  }, [appendLog, workerGeneration]);

  const cancel = useCallback((reason = "Search cancelled by user") => {
    const run = runRef.current;
    if (!run || uiPhase === "cancelling") return;
    run.cancel(reason);
    setUiPhase("cancelling");
    setStatusMessage("Cancelling search.");
    appendLog("Cancellation requested.", "warning", elapsedRef.current);
  }, [appendLog, uiPhase]);

  useEffect(() => {
    const nextKey = sessionKey(session);
    if (previousSessionKeyRef.current === nextKey) return;
    previousSessionKeyRef.current = nextKey;

    runTokenRef.current += 1;
    runRef.current?.cancel("Puzzle state changed");
    runRef.current = null;
    startedAtRef.current = null;
    setProgress(null);
    setResult(null);
    setRunFingerprint(null);
    setRunSolverId(null);
    setLiveElapsedMs(0);
    setLogEntries([]);
    lastProgressLogRef.current = {
      elapsedMs: Number.NEGATIVE_INFINITY,
    };
    setUiPhase(clientRef.current ? "ready" : "loading");
    setStatusMessage("Puzzle state changed. Start a new search when ready.");
    appendLog("Previous search cleared because the puzzle state changed.");
  }, [appendLog, session]);

  useEffect(() => {
    if (previousOpenRef.current && !open) {
      cancel("Solver dialog closed");
    }
    previousOpenRef.current = open;
  }, [cancel, open]);

  useEffect(() => {
    if (uiPhase !== "running" && uiPhase !== "cancelling") return;

    const updateElapsed = () => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) {
        const elapsed = Math.max(0, performance.now() - startedAt);
        elapsedRef.current = elapsed;
        setLiveElapsedMs(elapsed);
      }
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 500);
    return () => window.clearInterval(timer);
  }, [uiPhase]);

  const start = useCallback(() => {
    const client = clientRef.current;
    const metadata = selectedSolver;
    if (
      !client ||
      !metadata ||
      uiPhase === "running" ||
      uiPhase === "cancelling"
    ) {
      return;
    }

    const fingerprint = fingerprintFor(session);
    const token = ++runTokenRef.current;
    const maxMemoryBytes =
      memoryLimitMiB > 0
        ? memoryLimitMiB * MEBIBYTE
        : automaticMemoryLimitBytes();

    setProgress(null);
    setResult(null);
    setError(null);
    setRunFingerprint(fingerprint);
    setRunSolverId(metadata.id);
    setLogEntries([]);
    setLiveElapsedMs(0);
    lastProgressLogRef.current = {
      elapsedMs: Number.NEGATIVE_INFINITY,
    };
    startedAtRef.current = performance.now();
    setUiPhase("running");
    setStatusMessage(`${metadata.displayName} search started.`);
    appendLog(`Starting ${metadata.displayName} to minimize moves.`);

    let handle: SolverRunHandle;
    try {
      handle = client.run(
        metadata.id,
        {
          board: session.board,
          snapshot: session.snapshot,
          objective: { kind: "moves" },
          limits: {
            maxMemoryBytes,
            ...(timeLimitMs > 0 ? { maxElapsedMs: timeLimitMs } : {}),
          },
        },
        {
          onProgress(update) {
            if (runTokenRef.current !== token) return;
            setProgress(update);
            setLiveElapsedMs((current) =>
              Math.max(current, update.elapsedMs),
            );

            const last = lastProgressLogRef.current;
            const phaseChanged = last.phase !== update.phase;
            const intervalPassed =
              update.elapsedMs - last.elapsedMs >= PROGRESS_LOG_INTERVAL_MS;
            if (phaseChanged || intervalPassed) {
              lastProgressLogRef.current = {
                elapsedMs: update.elapsedMs,
                phase: update.phase,
              };
              appendLog(
                progressLogMessage(update),
                "info",
                update.elapsedMs,
              );
              if (phaseChanged) {
                setStatusMessage(phaseLabel(update.phase));
              }
            }
          },
        },
      );
      runRef.current = handle;
    } catch (caught) {
      const message = errorMessage(caught);
      startedAtRef.current = null;
      setUiPhase("error");
      setError(message);
      setStatusMessage(`Search failed: ${message}`);
      appendLog(message, "error");
      return;
    }

    void handle.result.then(
      (nextResult) => {
        if (runTokenRef.current !== token) return;
        runRef.current = null;
        startedAtRef.current = null;
        setLiveElapsedMs(nextResult.metrics.elapsedMs);

        if (
          fingerprintKey(fingerprint) !==
          sessionKey(currentSessionRef.current)
        ) {
          setResult(null);
          setRunFingerprint(null);
          setRunSolverId(null);
          setUiPhase("ready");
          setStatusMessage("The puzzle changed, so the result was discarded.");
          appendLog(
            "Result discarded because the puzzle state changed.",
            "warning",
            nextResult.metrics.elapsedMs,
          );
          return;
        }

        setResult(nextResult);
        const summary = resultSummary(nextResult);
        setStatusMessage(summary);
        if (nextResult.status === "solved") {
          setUiPhase("solved");
          appendLog(summary, "success", nextResult.metrics.elapsedMs);
        } else if (nextResult.status === "cancelled") {
          setUiPhase("cancelled");
          appendLog(summary, "warning", nextResult.metrics.elapsedMs);
        } else {
          setUiPhase("unsolved");
          appendLog(summary, "warning", nextResult.metrics.elapsedMs);
        }
      },
      (caught) => {
        if (runTokenRef.current !== token) return;
        runRef.current = null;
        startedAtRef.current = null;
        const message = errorMessage(caught);
        setUiPhase("error");
        setError(message);
        setStatusMessage(`Search failed: ${message}`);
        appendLog(message, "error", elapsedRef.current);
      },
    );
  }, [
    appendLog,
    memoryLimitMiB,
    selectedSolver,
    session,
    timeLimitMs,
    uiPhase,
  ]);

  const retryConnection = useCallback(() => {
    const discoveryEntry: SolverLogEntry = Object.freeze({
      id: nextLogIdRef.current++,
      elapsedMs: 0,
      message: "Discovering available search algorithms.",
      tone: "info",
    });
    setSolvers([]);
    setSelectedSolverId("");
    setError(null);
    setProgress(null);
    setResult(null);
    setRunFingerprint(null);
    setRunSolverId(null);
    setLogEntries([discoveryEntry]);
    setUiPhase("loading");
    setStatusMessage("Retrying the solver worker connection.");
    setWorkerGeneration((current) => current + 1);
  }, []);

  const terminalMetrics = result?.metrics;
  const counters = terminalMetrics?.counters ?? progress?.counters;
  const resultSolver = solvers.find(({ id }) => id === runSolverId);
  const expandedStates =
    terminalMetrics?.expandedStates ?? progress?.expandedStates;
  const generatedStates =
    terminalMetrics?.generatedStates ?? progress?.generatedStates;
  const frontierSize =
    progress?.frontierSize ??
    (result ? 0 : undefined);
  const peakFrontierSize = terminalMetrics?.peakFrontierSize;
  const running = uiPhase === "running" || uiPhase === "cancelling";
  const currentFingerprint = fingerprintFor(session);
  const canPlay =
    result?.status === "solved" &&
    runFingerprint !== null &&
    fingerprintKey(runFingerprint) === fingerprintKey(currentFingerprint);

  return {
    solvers,
    selectedSolver,
    selectedSolverId,
    setSelectedSolverId,
    timeLimitMs,
    setTimeLimitMs,
    memoryLimitMiB,
    setMemoryLimitMiB,
    uiPhase,
    running,
    progress,
    result,
    resultSolver,
    runFingerprint,
    error,
    statusMessage,
    logEntries,
    liveElapsedMs,
    expandedStates,
    generatedStates,
    frontierSize,
    peakFrontierSize,
    counters,
    canPlay,
    start,
    cancel,
    retryConnection,
  } as const;
}

export type SolverPlaybackRequest = Readonly<{
  steps: readonly SolutionStep[];
  fingerprint: SolverRunFingerprint;
}>;
