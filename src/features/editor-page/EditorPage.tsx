import { useCallback, useEffect, useMemo, useState } from "react";
import { DIFFICULTIES, type Difficulty } from "@/src/core/model";
import { validatePuzzle, createSession } from "@/src/core";
import { Board } from "@/src/features/game/Board";
import { ExperienceControls } from "@/src/features/experience";
import {
  stateToPuzzle,
  validateEditorState,
  MIN_SIZE,
  MAX_SIZE,
} from "@/src/features/editor/editor-model";
import { encodePuzzleUrl, decodeCustomPuzzle } from "@/src/features/editor/editor-serialization";
import { useEditorState } from "@/src/features/editor/use-editor-state";
import { EditorGrid } from "@/src/features/editor/EditorGrid";
import { EditorToolbar } from "@/src/features/editor/EditorToolbar";
import { Link, homeHash } from "@/src/router";
import styles from "./EditorPage.module.css";

interface EditorPageProps {
  readonly customData?: string;
}

export function EditorPage({ customData }: EditorPageProps) {
  const [state, dispatch] = useEditorState();
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    document.title = "Puzzle Editor · Sokomind";
  }, []);

  useEffect(() => {
    if (!customData) return;
    const puzzle = decodeCustomPuzzle(`#custom=${customData}`);
    if (puzzle) {
      dispatch({ type: "load", puzzle });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editorValidation = useMemo(
    () => validateEditorState(state),
    [state],
  );

  const coreValidation = useMemo(() => {
    if (!editorValidation.valid) return null;
    const puzzle = stateToPuzzle(state);
    return validatePuzzle(puzzle);
  }, [editorValidation.valid, state]);

  const isValid = editorValidation.valid && (coreValidation?.valid ?? false);

  const testSession = useMemo(() => {
    if (!testing || !isValid) return null;
    try {
      return createSession(stateToPuzzle(state));
    } catch {
      return null;
    }
  }, [testing, isValid, state]);

  const handleTest = useCallback(() => {
    if (!isValid) return;
    setTesting(true);
  }, [isValid]);

  const handleShare = useCallback(async () => {
    if (!isValid) return;
    const puzzle = stateToPuzzle(state);
    const hash = encodePuzzleUrl(puzzle);
    const url = new URL(window.location.href);
    url.hash = `/editor?custom=${hash.slice("#custom=".length)}`;
    const shareUrl = url.toString();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      }
    } catch {
      // Clipboard may fail silently.
    }
  }, [isValid, state]);

  const handleClear = useCallback(
    () => dispatch({ type: "clear" }),
    [dispatch],
  );

  return (
    <main className={styles.page}>
      <div className={styles.container}>
        <div className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <Link href={homeHash()} className={styles.backButton} aria-label="Back to home">
              <span aria-hidden="true">&larr;</span>
            </Link>
            <div className={styles.titleGroup}>
              <span className={styles.eyebrow}>Workshop</span>
              <h1 className={styles.pageTitle}>Puzzle Editor</h1>
            </div>
          </div>
          <ExperienceControls />
        </div>

        <div className={styles.content}>
          <div className={styles.sidebar}>
            <EditorToolbar
              selectedTool={state.selectedTool}
              dispatch={dispatch}
            />

            <div className={styles.sizeControls}>
              <label>
                Width
                <input
                  type="number"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  value={state.width}
                  onChange={(e) =>
                    dispatch({
                      type: "resize",
                      width: Number(e.currentTarget.value),
                      height: state.height,
                    })
                  }
                />
              </label>
              <label>
                Height
                <input
                  type="number"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  value={state.height}
                  onChange={(e) =>
                    dispatch({
                      type: "resize",
                      width: state.width,
                      height: Number(e.currentTarget.value),
                    })
                  }
                />
              </label>
            </div>
          </div>

          <div className={styles.gridWrap}>
            {testing && testSession ? (
              <Board session={testSession} reduceMotion={false} />
            ) : (
              <EditorGrid state={state} dispatch={dispatch} />
            )}
          </div>

          <div className={styles.sidebar}>
            <div className={styles.fields}>
              <label>
                Title
                <input
                  type="text"
                  value={state.title}
                  maxLength={60}
                  onChange={(e) =>
                    dispatch({
                      type: "set-title",
                      title: e.currentTarget.value,
                    })
                  }
                />
              </label>
              <label>
                Difficulty
                <select
                  value={state.difficulty}
                  onChange={(e) =>
                    dispatch({
                      type: "set-difficulty",
                      difficulty: e.currentTarget.value as Difficulty,
                    })
                  }
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {d.charAt(0).toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hint
                <textarea
                  value={state.hint}
                  maxLength={200}
                  rows={2}
                  onChange={(e) =>
                    dispatch({
                      type: "set-hint",
                      hint: e.currentTarget.value,
                    })
                  }
                />
              </label>
            </div>

            <div className={styles.validation}>
              {editorValidation.errors.map((error, i) => (
                <p key={i} className={styles.validationError}>
                  {error}
                </p>
              ))}
              {!editorValidation.valid ? null : coreValidation && !coreValidation.valid ? (
                coreValidation.errors.map((error, i) => (
                  <p key={i} className={styles.validationError}>
                    {error.message}
                  </p>
                ))
              ) : isValid ? (
                <p className={styles.validOk}>Puzzle is valid</p>
              ) : null}
            </div>

            <div className={styles.actions}>
              {testing ? (
                <button type="button" onClick={() => setTesting(false)}>
                  Back to editor
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    data-primary
                    disabled={!isValid}
                    onClick={handleTest}
                  >
                    Test puzzle
                  </button>
                  <button
                    type="button"
                    disabled={!isValid}
                    onClick={() => void handleShare()}
                  >
                    Share (copy URL)
                  </button>
                  <button
                    type="button"
                    data-danger
                    onClick={handleClear}
                  >
                    Clear board
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
