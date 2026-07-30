import {
  bidirectionalSide,
  search,
} from "./engine.generated.js";

interface EngineCommand {
  readonly mode: "search" | "bidir-forward" | "bidir-reverse";
  readonly payload: Readonly<Record<string, unknown>>;
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.onmessage = ({ data }: MessageEvent<EngineCommand>) => {
  try {
    if (data.mode === "bidir-forward" || data.mode === "bidir-reverse") {
      bidirectionalSide({
        ...data.payload,
        mode: data.mode,
      });
      return;
    }

    const result = search(data.payload);
    self.postMessage({ type: "done", ...result });
  } catch (error) {
    self.postMessage({
      type: "done",
      status: "failed",
      terminationReason: "worker-exception",
      error: serializeError(error),
      path: null,
      visited: 0,
      generated: 0,
    });
  }
};
