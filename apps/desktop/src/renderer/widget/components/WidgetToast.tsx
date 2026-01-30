import React from "react";
import type { WidgetNotificationAction } from "@/types/widget-notification";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface WidgetToastProps {
  title: string;
  description: string;
  isError?: boolean;
  showRecordingSaved?: boolean;
  traceId?: string;
  primaryAction?: WidgetNotificationAction;
  secondaryAction?: WidgetNotificationAction;
  onActionClick: (action: WidgetNotificationAction) => void;
}

export const WidgetToast: React.FC<WidgetToastProps> = ({
  title,
  description,
  isError,
  showRecordingSaved,
  traceId,
  primaryAction,
  secondaryAction,
  onActionClick,
}) => {
  const handleCopyTraceId = async () => {
    if (traceId) {
      await navigator.clipboard.writeText(traceId);
    }
  };

  return (
    <Card className="min-w-[300px] gap-3 py-4 shadow-lg">
      <CardHeader className="gap-1 px-4 py-0 text-center">
        <CardTitle className={`text-sm ${isError ? "text-destructive" : ""}`}>
          {title}
        </CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
        {showRecordingSaved && (
          <p className="text-muted-foreground text-xs">
            Your recording is saved. You can access it in History.
          </p>
        )}
      </CardHeader>

      <CardFooter className="flex-col items-center gap-2 px-4 py-0">
        <div className="flex gap-2">
          {secondaryAction && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onActionClick(secondaryAction)}
            >
              {secondaryAction.icon === "discord" && (
                <img
                  src="assets/discord-icon.svg"
                  alt="Discord"
                  className="size-3.5"
                />
              )}
              {secondaryAction.label}
            </Button>
          )}
          {primaryAction && (
            <Button
              variant="default"
              size="sm"
              className="flex-1"
              onClick={() => onActionClick(primaryAction)}
            >
              {primaryAction.icon === "discord" && (
                <img
                  src="assets/discord-icon.svg"
                  alt="Discord"
                  className="size-3.5"
                />
              )}
              {primaryAction.label}
            </Button>
          )}
        </div>
        {traceId && (
          <button
            onClick={handleCopyTraceId}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Copy Error ID
          </button>
        )}
      </CardFooter>
    </Card>
  );
};
