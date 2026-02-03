import React, { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { withTranslation, type WithTranslation } from "react-i18next";

interface Props extends WithTranslation {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for onboarding flow
 * T044 - Catches and displays errors gracefully
 */
class OnboardingErrorBoundaryBase extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Onboarding error caught:", error, errorInfo);
    // Error logged to console - main process can monitor renderer logs if needed
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleRestart = () => {
    // Reload the page to restart onboarding
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const { t } = this.props;
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-8">
          <Card className="max-w-md p-8">
            <div className="flex flex-col items-center space-y-6 text-center">
              {/* Error Icon */}
              <div className="rounded-full bg-destructive/10 p-4">
                <AlertTriangle className="h-12 w-12 text-destructive" />
              </div>

              {/* Error Message */}
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold">
                  {t("onboarding.errorBoundary.title")}
                </h2>
                <p className="text-muted-foreground">
                  {t("onboarding.errorBoundary.description")}
                </p>
              </div>

              {/* Error Details (in development) */}
              {process.env.NODE_ENV === "development" && this.state.error && (
                <div className="w-full rounded-lg bg-muted p-4 text-left">
                  <p className="font-mono text-xs text-muted-foreground">
                    {this.state.error.message}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex w-full gap-3">
                <Button
                  variant="outline"
                  onClick={this.handleReset}
                  className="flex-1 gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  {t("onboarding.errorBoundary.tryAgain")}
                </Button>
                <Button onClick={this.handleRestart} className="flex-1">
                  {t("onboarding.errorBoundary.restart")}
                </Button>
              </div>

              {/* Support Note */}
              <p className="text-xs text-muted-foreground">
                {t("onboarding.errorBoundary.supportNote")}
              </p>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// `withTranslation` gives this class component access to `t()` via props.
export const OnboardingErrorBoundary = withTranslation()(
  OnboardingErrorBoundaryBase,
);
