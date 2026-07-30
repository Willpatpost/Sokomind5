import { useCallback, useEffect, useRef, useState } from "react";
import type { GameSession } from "@/src/core/model";
import {
  createSolverWorkerClient,
  type SolverWorkerClient,
  type SolutionStep,
} from "@/src/solver";

const HINT_STEPS = 3;
const HINT_TIME_LIMIT_MS = 5_000;
const HINT_MEMORY_LIMIT = 128 * 1024 * 1024;
const HINT_SOLVER_ID = "classic-astar";

export type HintPhase = "idle" | "thinking" | "playing";

interface SolutionFingerprint {
  readonly puzzleId: string;
  readonly actionLog: string;
}

export interface HintController {
  readonly phase: HintPhase;
  readonly canHint: boolean;
  requestHint(): void;
}

interface HintControllerOptions {
  readonly session: GameSession;
  readonly disabled?: boolean;
  readonly onPlaySteps: (
    steps: readonly SolutionStep[],
    fingerprint: SolutionFingerprint,
  ) => void;
  readonly onToast: (message: string) => void;
}

export function useHintController({
  session,
  disabled = false,
  onPlaySteps,
  onToast,
}: HintControllerOptions): HintController {
  const [phase, setPhase] = useState<HintPhase>("idle");
  const clientRef = useRef<SolverWorkerClient | null>(null);
  const tokenRef = useRef(0);
  const failureCountRef = useRef(0);
  const cooldownUntilRef = useRef(0);

  const canHint = !disabled && !session.solved && phase !== "thinking";

  useEffect(
    () => () => {
      tokenRef.current += 1;
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  useEffect(() => {
    failureCountRef.current = 0;
    cooldownUntilRef.current = 0;
  }, [session.puzzle.id]);

  const requestHint = useCallback(() => {
    if (Date.now() < cooldownUntilRef.current) {
      onToast("Hints temporarily unavailable. Try again shortly.");
      return;
    }
    if (session.solved || disabled) return;

    const token = ++tokenRef.current;
    setPhase("thinking");

    const fingerprint: SolutionFingerprint = {
      puzzleId: session.puzzle.id,
      actionLog: session.actionLog,
    };

    const ensureClient = (): SolverWorkerClient | null => {
      if (clientRef.current) return clientRef.current;
      try {
        const worker = new Worker(
          new URL("../../solver/solver.worker.ts", import.meta.url),
          { type: "module", name: "sokomind-hint" },
        );
        const client = createSolverWorkerClient(worker);
        clientRef.current = client;
        return client;
      } catch (error) {
        console.warn("Sokomind: hint worker failed to start", error);
        failureCountRef.current += 1;
        if (failureCountRef.current >= 3) {
          cooldownUntilRef.current = Date.now() + 30_000;
          onToast("Hints temporarily unavailable.");
        } else {
          onToast("Could not start the hint solver.");
        }
        setPhase("idle");
        return null;
      }
    };

    const client = ensureClient();
    if (!client) return;

    void (async () => {
      try {
        await client.discover();
        if (tokenRef.current !== token) return;

        const handle = client.run(HINT_SOLVER_ID, {
          board: session.board,
          snapshot: session.snapshot,
          objective: { kind: "moves" },
          limits: {
            maxElapsedMs: HINT_TIME_LIMIT_MS,
            maxMemoryBytes: HINT_MEMORY_LIMIT,
          },
        });

        const result = await handle.result;
        if (tokenRef.current !== token) return;

        if (result.status === "solved") {
          failureCountRef.current = 0;
          const hintSteps = result.solution.steps.slice(0, HINT_STEPS);
          setPhase("playing");
          onPlaySteps(hintSteps, fingerprint);
          setTimeout(() => {
            if (tokenRef.current === token) setPhase("idle");
          }, hintSteps.length * 200 + 300);
        } else if (result.status === "unsolved") {
          setPhase("idle");
          onToast("This position might be stuck — try undoing some moves.");
        } else {
          setPhase("idle");
        }
      } catch (error) {
        console.warn("Sokomind: hint search failed", error);
        if (tokenRef.current !== token) return;
        failureCountRef.current += 1;
        if (failureCountRef.current >= 3) {
          cooldownUntilRef.current = Date.now() + 30_000;
          onToast("Hints temporarily unavailable.");
        } else {
          onToast("Hint search failed — try again.");
        }
        setPhase("idle");
        clientRef.current?.dispose();
        clientRef.current = null;
      }
    })();
  }, [session, disabled, onPlaySteps, onToast]);

  return { phase, canHint, requestHint };
}
