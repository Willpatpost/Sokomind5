/**
 * Soft search-ordering parameters for Sokomind Solver.
 *
 * This is deliberately separate from legality, deadlock rejection, replay
 * verification, and resource limits. Automated tuning may change these
 * values, but it cannot make an illegal route valid or turn an ordering hint
 * into a hard prune.
 */
export interface SokomindTuningProfile {
  readonly schemaVersion: 1;
  readonly planMoveWeight: number;
  readonly heuristicWeight: number;
  readonly costWeight: number;
  readonly goalPackingWeight: number;
  readonly mobilityWeight: number;
  readonly topologyWeight: number;
  readonly evacuationWeight: number;
  readonly supportDependencyWeight: number;
  readonly localRoomWeight: number;
  readonly doorwayFlowWeight: number;
  readonly relevanceWeight: number;
}

export type SokomindTuningOverrides = Readonly<
  Partial<Omit<SokomindTuningProfile, "schemaVersion">> & {
    readonly schemaVersion?: 1;
  }
>;

export const DEFAULT_SOKOMIND_TUNING: SokomindTuningProfile = Object.freeze({
  schemaVersion: 1,
  planMoveWeight: 0.005,
  heuristicWeight: 3,
  costWeight: 0,
  goalPackingWeight: 0.8,
  mobilityWeight: 0.03,
  topologyWeight: 0.7,
  evacuationWeight: 0,
  supportDependencyWeight: 0.8,
  localRoomWeight: 0.6,
  doorwayFlowWeight: 0.35,
  relevanceWeight: 0.6,
});

const TUNABLE_KEYS = Object.freeze([
  "planMoveWeight",
  "heuristicWeight",
  "costWeight",
  "goalPackingWeight",
  "mobilityWeight",
  "topologyWeight",
  "evacuationWeight",
  "supportDependencyWeight",
  "localRoomWeight",
  "doorwayFlowWeight",
  "relevanceWeight",
] as const);

type TunableKey = (typeof TUNABLE_KEYS)[number];
const ALLOWED_OVERRIDE_KEYS = new Set<string>([
  "schemaVersion",
  ...TUNABLE_KEYS,
]);

function checkedWeight(key: TunableKey, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(
      `Sokomind tuning value "${key}" must be finite and between 0 and 100.`,
    );
  }
  return value;
}

export function resolveSokomindTuning(
  overrides: SokomindTuningOverrides = {},
): SokomindTuningProfile {
  if (
    typeof overrides !== "object" ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new TypeError("Sokomind tuning overrides must be an object.");
  }
  for (const key of Object.keys(overrides)) {
    if (!ALLOWED_OVERRIDE_KEYS.has(key)) {
      throw new TypeError(`Unknown Sokomind tuning key "${key}".`);
    }
  }
  if (
    overrides.schemaVersion !== undefined &&
    overrides.schemaVersion !== DEFAULT_SOKOMIND_TUNING.schemaVersion
  ) {
    throw new RangeError(
      `Unsupported Sokomind tuning schema version ${String(overrides.schemaVersion)}.`,
    );
  }
  const resolved = Object.fromEntries(
    TUNABLE_KEYS.map((key) => [
      key,
      checkedWeight(key, overrides[key] ?? DEFAULT_SOKOMIND_TUNING[key]),
    ]),
  ) as unknown as Omit<SokomindTuningProfile, "schemaVersion">;

  return Object.freeze({
    schemaVersion: 1,
    ...resolved,
  });
}

/**
 * Stable identity used by benchmark output and future optimizer datasets.
 */
export function sokomindTuningFingerprint(
  profile: SokomindTuningProfile,
): string {
  return [
    `v${profile.schemaVersion}`,
    ...TUNABLE_KEYS.map((key) => `${key}=${profile[key]}`),
  ].join(";");
}

/**
 * Translate the public profile to the legacy engine's payload vocabulary.
 */
export function sokomindTuningPayload(
  profile: SokomindTuningProfile,
): Readonly<Record<string, number>> {
  return Object.freeze({
    planMoveWeight: profile.planMoveWeight,
    weight: profile.heuristicWeight,
    costWeight: profile.costWeight,
    goalPackingWeight: profile.goalPackingWeight,
    mobilityWeight: profile.mobilityWeight,
    topologyWeight: profile.topologyWeight,
    evacuationWeight: profile.evacuationWeight,
    supportDependencyWeight: profile.supportDependencyWeight,
    localRoomWeight: profile.localRoomWeight,
    doorwayFlowWeight: profile.doorwayFlowWeight,
    relevanceWeight: profile.relevanceWeight,
  });
}
