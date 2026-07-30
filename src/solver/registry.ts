import type { SolverAdapter, SolverMetadata } from "./contracts.ts";

const SOLVER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export class DuplicateSolverError extends Error {
  readonly solverId: string;

  constructor(solverId: string) {
    super(`A solver with id "${solverId}" is already registered.`);
    this.name = "DuplicateSolverError";
    this.solverId = solverId;
  }
}

export class SolverNotFoundError extends Error {
  readonly solverId: string;

  constructor(solverId: string) {
    super(`No solver with id "${solverId}" is registered.`);
    this.name = "SolverNotFoundError";
    this.solverId = solverId;
  }
}

export class InvalidSolverAdapterError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSolverAdapterError";
  }
}

export interface SolverRegistration {
  readonly solverId: string;
  /**
   * Removes exactly the adapter represented by this registration.
   */
  unregister(): boolean;
}

function assertNonEmpty(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidSolverAdapterError(
      `Solver metadata "${field}" must not be empty.`,
    );
  }
}

export function assertValidSolverAdapter(
  adapter: SolverAdapter,
): asserts adapter is SolverAdapter {
  if (!adapter || typeof adapter !== "object") {
    throw new InvalidSolverAdapterError("Solver adapter must be an object.");
  }
  if (typeof adapter.solve !== "function") {
    throw new InvalidSolverAdapterError(
      "Solver adapter must provide a solve function.",
    );
  }

  const metadata = adapter.metadata;
  if (!metadata || typeof metadata !== "object") {
    throw new InvalidSolverAdapterError(
      "Solver adapter must provide metadata.",
    );
  }

  assertNonEmpty(metadata.id, "id");
  if (!SOLVER_ID_PATTERN.test(metadata.id)) {
    throw new InvalidSolverAdapterError(
      `Solver id "${metadata.id}" must be lowercase and URL-safe.`,
    );
  }
  assertNonEmpty(metadata.displayName, "displayName");
  assertNonEmpty(metadata.description, "description");
  assertNonEmpty(metadata.version, "version");

  const capabilities = metadata.capabilities;
  if (!capabilities || typeof capabilities !== "object") {
    throw new InvalidSolverAdapterError(
      "Solver metadata must declare capabilities.",
    );
  }
  if (
    !Array.isArray(capabilities.executionTargets) ||
    capabilities.executionTargets.length === 0
  ) {
    throw new InvalidSolverAdapterError(
      "Solver must support at least one execution target.",
    );
  }
  if (
    !Array.isArray(capabilities.objectives) ||
    capabilities.objectives.length === 0
  ) {
    throw new InvalidSolverAdapterError(
      "Solver must support at least one objective.",
    );
  }
}

/**
 * Process-local solver discovery. The registry owns no UI and starts no
 * workers; composition roots choose which adapters to register.
 */
export class SolverRegistry {
  readonly #adapters = new Map<string, SolverAdapter>();

  constructor(adapters: Iterable<SolverAdapter> = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  get size(): number {
    return this.#adapters.size;
  }

  register(adapter: SolverAdapter): SolverRegistration {
    assertValidSolverAdapter(adapter);
    const { id } = adapter.metadata;
    if (this.#adapters.has(id)) throw new DuplicateSolverError(id);

    this.#adapters.set(id, adapter);
    let active = true;
    return {
      solverId: id,
      unregister: () => {
        if (!active || this.#adapters.get(id) !== adapter) return false;
        active = false;
        return this.#adapters.delete(id);
      },
    };
  }

  unregister(solverId: string): boolean {
    return this.#adapters.delete(solverId);
  }

  has(solverId: string): boolean {
    return this.#adapters.has(solverId);
  }

  get(solverId: string): SolverAdapter | undefined {
    return this.#adapters.get(solverId);
  }

  require(solverId: string): SolverAdapter {
    const adapter = this.get(solverId);
    if (!adapter) throw new SolverNotFoundError(solverId);
    return adapter;
  }

  list(): readonly SolverAdapter[] {
    return Object.freeze([...this.#adapters.values()]);
  }

  listMetadata(): readonly SolverMetadata[] {
    return Object.freeze(
      [...this.#adapters.values()].map((adapter) => adapter.metadata),
    );
  }
}
