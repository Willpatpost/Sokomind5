import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function clearAppStorage(): void {
  try {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("sokomind"),
    );
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Sokomind caught an unrecoverable rendering error:", error, info);
  }

  #handleReset = () => {
    clearAppStorage();
    window.location.hash = "";
    window.location.reload();
  };

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          color: "var(--ink-950)",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>
          Something went wrong
        </h1>
        <p style={{ maxWidth: "28rem", marginBottom: "1.5rem", color: "var(--ink-muted)" }}>
          Sokomind hit an unexpected error. Resetting clears your saved progress
          and reloads the page.
        </p>
        <button
          onClick={this.#handleReset}
          type="button"
          style={{
            padding: "0.625rem 1.5rem",
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--paper-50)",
            background: "var(--coral-500)",
            border: "none",
            borderRadius: "10px",
            cursor: "pointer",
          }}
        >
          Reset and reload
        </button>
        <details
          style={{
            marginTop: "2rem",
            maxWidth: "32rem",
            textAlign: "left",
            color: "var(--ink-muted)",
            fontSize: "0.8125rem",
          }}
        >
          <summary style={{ cursor: "pointer" }}>Error details</summary>
          <pre
            style={{
              marginTop: "0.5rem",
              padding: "0.75rem",
              background: "var(--paper-100)",
              borderRadius: "8px",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
            {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
          </pre>
        </details>
      </div>
    );
  }
}
