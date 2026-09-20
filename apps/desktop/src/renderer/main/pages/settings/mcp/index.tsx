import { useState } from "react";
import { Check, Copy, RefreshCw, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/trpc/react";

export default function McpSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();
  const [copied, setCopied] = useState(false);

  const settingsQuery = api.settings.getMcpServerSettings.useQuery();
  const settings = settingsQuery.data;

  const updateMutation = api.settings.setMcpServerSettings.useMutation({
    onSuccess: () => {
      utils.settings.getMcpServerSettings.invalidate();
      toast.success(t("settings.mcp.toast.updated"));
    },
    onError: (error) => {
      toast.error(
        t("settings.mcp.toast.updateFailed", { message: error.message }),
      );
    },
  });

  const regenerateTokenMutation =
    api.settings.regenerateMcpServerToken.useMutation({
      onSuccess: () => {
        utils.settings.getMcpServerSettings.invalidate();
        toast.success(t("settings.mcp.toast.tokenRegenerated"));
      },
      onError: (error) => {
        toast.error(
          t("settings.mcp.toast.tokenRegenerateFailed", {
            message: error.message,
          }),
        );
      },
    });

  const isBusy = settingsQuery.isLoading || updateMutation.isPending;

  const handleEnabledChange = (checked: boolean) => {
    if (!settings) return;
    updateMutation.mutate({ ...settings, enabled: checked });
  };

  const handlePortBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (!settings) return;
    const port = Number(event.target.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    if (port === settings.port) return;
    updateMutation.mutate({ ...settings, port });
  };

  const connectCommand = settings
    ? `claude mcp add --transport http amical http://127.0.0.1:${settings.port}/mcp --header "Authorization: Bearer ${settings.token}"`
    : "";

  const handleCopyCommand = async () => {
    if (!connectCommand) return;
    await navigator.clipboard.writeText(connectCommand);
    setCopied(true);
    toast.success(t("settings.mcp.toast.commandCopied"));
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.mcp.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.mcp.description")}
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground">
                  <Server className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-base font-medium text-foreground">
                      {t("settings.mcp.enable.label")}
                    </Label>
                    <Badge
                      variant={settings?.enabled ? "default" : "secondary"}
                    >
                      {settings?.enabled
                        ? t("settings.mcp.status.running")
                        : t("settings.mcp.status.stopped")}
                    </Badge>
                  </div>
                  <p className="max-w-2xl text-xs text-muted-foreground">
                    {t("settings.mcp.enable.description")}
                  </p>
                </div>
              </div>
              <Switch
                checked={settings?.enabled ?? false}
                onCheckedChange={handleEnabledChange}
                disabled={isBusy}
                aria-label={t("settings.mcp.enable.ariaLabel")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mcp-port">{t("settings.mcp.port.label")}</Label>
                <Input
                  id="mcp-port"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={settings?.port}
                  key={settings?.port}
                  onBlur={handlePortBlur}
                  disabled={isBusy}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mcp-token">
                  {t("settings.mcp.token.label")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="mcp-token"
                    readOnly
                    value={settings?.token ?? ""}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={regenerateTokenMutation.isPending}
                    onClick={() => regenerateTokenMutation.mutate()}
                    aria-label={t("settings.mcp.token.regenerateAriaLabel")}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("settings.mcp.connectCommand.label")}</Label>
              <div className="flex items-start gap-2">
                <code className="flex-1 overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 text-xs">
                  {connectCommand}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopyCommand}
                  disabled={!settings?.enabled}
                  aria-label={t("settings.mcp.connectCommand.copyAriaLabel")}
                >
                  {copied ? (
                    <Check className="size-4" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.mcp.connectCommand.description")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
