import React from "react";
import { XIcon } from "lucide-react";
import type {
  LocalizedText,
  WidgetNotificationAction,
} from "@/types/widget-notification";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslation } from "react-i18next";

interface WidgetToastProps {
  title: LocalizedText;
  description: LocalizedText;
  subDescription?: LocalizedText;
  isError?: boolean;
  traceId?: string;
  primaryAction?: WidgetNotificationAction;
  secondaryAction?: WidgetNotificationAction;
  onActionClick: (action: WidgetNotificationAction) => void;
  onDismiss: () => void;
}

export const WidgetToast: React.FC<WidgetToastProps> = ({
  title,
  description,
  subDescription,
  isError,
  traceId,
  primaryAction,
  secondaryAction,
  onActionClick,
  onDismiss,
}) => {
  const { t } = useTranslation();

  const resolveText = (value: LocalizedText) => {
    if (typeof value === "string") return value;
    return t(value.key, value.params);
  };

  const handleCopyTraceId = async () => {
    if (traceId) {
      await navigator.clipboard.writeText(traceId);
    }
  };

  return (
    <Card className="relative min-w-[300px] gap-3 py-4 shadow-lg">
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("widget.notifications.dismiss")}
        className="text-muted-foreground hover:text-foreground absolute top-1 right-1 flex size-8 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden"
      >
        <XIcon className="size-4" />
      </button>
      <CardHeader className="gap-1 px-4 py-0 text-center">
        <CardTitle className={`text-sm ${isError ? "text-destructive" : ""}`}>
          {resolveText(title)}
        </CardTitle>
        <CardDescription className="text-xs">
          {resolveText(description)}
        </CardDescription>
        {subDescription && (
          <p className="text-muted-foreground text-xs">
            {resolveText(subDescription)}
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
                  alt={t("widget.notifications.discordAlt")}
                  className="size-3.5"
                />
              )}
              {resolveText(secondaryAction.label)}
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
                  alt={t("widget.notifications.discordAlt")}
                  className="size-3.5"
                />
              )}
              {resolveText(primaryAction.label)}
            </Button>
          )}
        </div>
        {traceId && (
          <button
            onClick={handleCopyTraceId}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            {t("widget.notifications.copyErrorId")}
          </button>
        )}
      </CardFooter>
    </Card>
  );
};
