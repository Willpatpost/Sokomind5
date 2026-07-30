import { lazy, Suspense } from "react";
import { useRouter } from "@/src/router";

const HomePage = lazy(() =>
  import("@/src/features/home/HomePage").then((m) => ({ default: m.HomePage })),
);
const PuzzleSelectorPage = lazy(() =>
  import("@/src/features/selector/PuzzleSelectorPage").then((m) => ({
    default: m.PuzzleSelectorPage,
  })),
);
const PlayPage = lazy(() =>
  import("@/src/features/play/PlayPage").then((m) => ({ default: m.PlayPage })),
);
const EditorPage = lazy(() =>
  import("@/src/features/editor-page/EditorPage").then((m) => ({
    default: m.EditorPage,
  })),
);

export function AppShell() {
  const { route } = useRouter();

  return (
    <Suspense fallback={null}>
      {route.page === "home" && <HomePage />}
      {(route.page === "puzzles" ||
        route.page === "puzzles-difficulty" ||
        route.page === "puzzles-collection") && (
        <PuzzleSelectorPage route={route} />
      )}
      {route.page === "play" && (
        <PlayPage puzzleId={route.puzzleId} actionLog={route.actionLog} />
      )}
      {route.page === "editor" && <EditorPage customData={route.customData} />}
    </Suspense>
  );
}
