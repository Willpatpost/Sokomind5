export interface LegacyEngineResult {
  readonly path?: readonly string[] | null;
  readonly status?: string;
  readonly terminationReason?: string;
  readonly cutoff?: boolean;
  readonly visited?: number;
  readonly generated?: number;
  readonly retained?: number;
  readonly peakFrontier?: number;
  readonly performance?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

export function search(
  payload: Readonly<Record<string, unknown>>,
): LegacyEngineResult;

export function bidirectionalSide(
  payload: Readonly<Record<string, unknown>>,
): void;
