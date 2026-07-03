import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

// React error boundary. The v2 renderer previously had NONE, so a single throw during a
// child's render or effect unmounted the WHOLE React tree → a blank white screen (e.g. an
// Electron <webview> guest method called before dom-ready throws synchronously). This
// contains a subtree failure: it catches, logs, and shows an inline fallback so the rest of
// the app keeps running. Error boundaries must be class components (getDerivedStateFromError
// / componentDidCatch have no Hook equivalent).

interface ErrorBoundaryProps {
  children: ReactNode;
  // When this value changes, a previously-caught error is cleared so the new children get a
  // fresh render — pass e.g. the paneId so switching/reopening a pane retries automatically
  // instead of sticking on the fallback.
  resetKey?: string | number;
  // Custom fallback; receives the caught error + a reset() that retries the subtree.
  // Returning any value (including null) replaces the default card.
  fallback?: (error: Error, reset: () => void) => ReactNode;
  // Names the failed area in the default fallback ("the Browser pane", "this view").
  label?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[tide] UI error boundary caught:", error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private readonly reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    if (this.props.fallback !== undefined) {
      return this.props.fallback(error, this.reset);
    }
    return <PaneErrorFallback label={this.props.label} error={error} reset={this.reset} />;
  }
}

const fallbackContainer: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "10px",
  height: "100%",
  width: "100%",
  padding: "24px",
  textAlign: "center",
  color: "var(--tide-text)",
  background: "var(--tide-bg)",
};

function PaneErrorFallback(props: { label?: string; error: Error; reset: () => void }): ReactNode {
  return (
    <div data-error-fallback="pane" role="alert" style={fallbackContainer}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        Something went wrong in {props.label ?? "this view"}.
      </p>
      <p
        style={{
          margin: 0,
          maxWidth: "420px",
          color: "var(--tide-muted)",
          fontFamily: '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: "12px",
          wordBreak: "break-word",
        }}
      >
        {props.error.message}
      </p>
      <button type="button" onClick={props.reset} style={fallbackButton}>
        Retry
      </button>
    </div>
  );
}

const fallbackButton: CSSProperties = {
  marginTop: "4px",
  padding: "6px 14px",
  borderRadius: "8px",
  border: "1px solid var(--tide-line)",
  background: "var(--tide-surface)",
  color: "var(--tide-text)",
  font: '500 12px/1 Inter, ui-sans-serif, system-ui, sans-serif',
  cursor: "pointer",
};

// Top-level (whole-app) fallback: a persistent error would just re-throw on a plain retry,
// so offer a hard Reload alongside it. Use as the renderer root boundary's fallback.
export function AppErrorFallback(props: { error: Error; reset: () => void }): ReactNode {
  return (
    <div data-error-fallback="app" role="alert" style={{ ...fallbackContainer, position: "fixed", inset: 0 }}>
      <p style={{ margin: 0, fontWeight: 600, fontSize: "15px" }}>Tide hit an unexpected error.</p>
      <p
        style={{
          margin: 0,
          maxWidth: "460px",
          color: "var(--tide-muted)",
          fontFamily: '"Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: "12px",
          wordBreak: "break-word",
        }}
      >
        {props.error.message}
      </p>
      <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
        <button type="button" onClick={props.reset} style={fallbackButton}>
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ ...fallbackButton, background: "var(--tide-action)", color: "var(--tide-on-action)", borderColor: "var(--tide-action)" }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
