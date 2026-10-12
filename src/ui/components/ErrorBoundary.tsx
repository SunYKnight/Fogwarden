import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Changing the key clears a caught error, e.g. when the user navigates away. */
  resetKey: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  resetKey: string;
}

/** Shows a crashed page's error in place instead of blanking the whole window. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    return error ? (
      <div className="panel" style={{ margin: 12, borderColor: 'var(--danger)' }}>
        <h2>This page crashed</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{error.stack ?? error.message}</pre>
      </div>
    ) : (
      this.props.children
    );
  }
}
