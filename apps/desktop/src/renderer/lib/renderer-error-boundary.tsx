import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureRendererException, type RendererSurface } from "./posthog";
import { RendererErrorFallback } from "./renderer-error-fallback";

interface Props {
  children?: ReactNode;
  surface: RendererSurface;
}

interface State {
  hasError: boolean;
  error: unknown;
}

export class RendererErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null };

  public static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureRendererException(error, {
      error_context: "root_render_failed",
      surface: this.props.surface,
      component_stack: errorInfo.componentStack ?? "",
    });
  }

  private resetErrorBoundary = (): void => {
    this.setState({ hasError: false, error: null });
  };

  public render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <RendererErrorFallback
        error={this.state.error}
        resetErrorBoundary={this.resetErrorBoundary}
        surface={this.props.surface}
      />
    );
  }
}
