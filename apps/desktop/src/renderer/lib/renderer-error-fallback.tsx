import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setPassThroughReason } from "@/renderer/widget/pass-through";
import type { RendererSurface } from "./posthog";

// Vite provides this built-in flag to renderer bundles.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const SHOW_ERROR_DETAILS = import.meta.env.DEV;

interface Props {
  error: unknown;
  resetErrorBoundary: () => void;
  surface: RendererSurface;
}

export function RendererErrorFallback({
  error,
  resetErrorBoundary,
  surface,
}: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (surface !== "widget") return;
    setPassThroughReason("error", true);
    return () => setPassThroughReason("error", false);
  }, [surface]);

  return (
    <div
      role="alert"
      className="flex min-h-screen w-full items-center justify-center overflow-auto bg-background p-3 sm:p-6"
    >
      <Card className="w-full max-w-md border-border/70 p-4 shadow-lg sm:p-6">
        <div className="flex flex-col items-center gap-4 text-center sm:gap-5">
          <div className="rounded-full bg-destructive/10 p-2.5">
            <AlertTriangle
              aria-hidden="true"
              className="h-8 w-8 text-destructive"
            />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
              {t("errors.renderer.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("errors.renderer.description")}
            </p>
          </div>

          {SHOW_ERROR_DETAILS && (
            <div className="max-h-24 w-full overflow-auto rounded-lg bg-muted p-3 text-left">
              <p className="font-mono text-xs text-muted-foreground">
                {error instanceof Error ? error.message : String(error)}
              </p>
            </div>
          )}

          <div className="grid w-full grid-cols-1 gap-2 min-[420px]:grid-cols-2">
            <Button
              variant="outline"
              onClick={resetErrorBoundary}
              className="gap-2"
            >
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {t("errors.renderer.tryAgain")}
            </Button>
            <Button onClick={() => window.location.reload()}>
              {t("errors.renderer.reload")}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("errors.renderer.supportNote")}
          </p>
        </div>
      </Card>
    </div>
  );
}
