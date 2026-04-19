import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconRefresh } from "@tabler/icons-react";
import { api } from "@/trpc/react";

type DeviceValue = "auto" | "cpu" | `gpu:${number}`;

function isGpuValue(v: DeviceValue): v is `gpu:${number}` {
  return v.startsWith("gpu:");
}

function parseStored(
  compute:
    | { device: "auto" | "cpu" | "gpu"; gpuDevice?: number }
    | undefined,
): DeviceValue {
  if (!compute || compute.device === "auto") return "auto";
  if (compute.device === "cpu") return "cpu";
  return `gpu:${compute.gpuDevice ?? 0}`;
}

function toStored(value: DeviceValue): {
  device: "auto" | "cpu" | "gpu";
  gpuDevice?: number;
} {
  if (value === "auto" || value === "cpu") return { device: value };
  const index = Number(value.slice("gpu:".length));
  return { device: "gpu", gpuDevice: Number.isFinite(index) ? index : 0 };
}

function formatVram(mb: number | undefined): string | null {
  if (!mb || mb <= 0) return null;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

export default function HardwareSettingsPage() {
  const { t } = useTranslation();
  const utils = api.useUtils();

  const { data: compute, isLoading: computeLoading } =
    api.settings.getComputeSettings.useQuery();
  const { data: snapshot, refetch: refetchSnapshot, isFetching: snapshotLoading } =
    api.hardware.getSnapshot.useQuery(undefined, {
      staleTime: 5 * 60 * 1000,
    });

  const mutation = api.settings.setComputeSettings.useMutation({
    onSuccess: () => utils.settings.getComputeSettings.invalidate(),
  });

  const [selection, setSelection] = useState<DeviceValue>("auto");

  useEffect(() => {
    setSelection(parseStored(compute));
  }, [compute]);

  const hasAnyGpuBackend = useMemo(() => {
    const backends = snapshot?.availableBackends ?? [];
    return backends.some((b) => b !== "cpu");
  }, [snapshot]);

  const gpus = snapshot?.gpus ?? [];

  const handleChange = async (value: DeviceValue) => {
    setSelection(value);
    try {
      await mutation.mutateAsync(toStored(value));
    } catch (error) {
      console.error("Failed to update compute settings:", error);
      setSelection(parseStored(compute));
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-xl font-bold">{t("settings.hardware.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("settings.hardware.description")}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="compute-device"
                className="text-base font-semibold text-foreground"
              >
                {t("settings.hardware.computeDevice.label")}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {t("settings.hardware.computeDevice.description")}
              </p>
            </div>
            <Select
              value={selection}
              onValueChange={(value) => handleChange(value as DeviceValue)}
              disabled={computeLoading || mutation.isPending}
            >
              <SelectTrigger className="w-[260px]" id="compute-device">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  {t("settings.hardware.computeDevice.options.auto")}
                </SelectItem>
                <SelectItem value="cpu">
                  {t("settings.hardware.computeDevice.options.cpu")}
                </SelectItem>
                {gpus.map((gpu) => {
                  const vram = formatVram(gpu.vramMB);
                  const label = vram
                    ? `${gpu.model} · ${vram}`
                    : gpu.model;
                  return (
                    <SelectItem
                      key={`gpu:${gpu.index}`}
                      value={`gpu:${gpu.index}`}
                    >
                      {label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {isGpuValue(selection) && !hasAnyGpuBackend && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t("settings.hardware.warnings.noGpuBackend")}
            </div>
          )}

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium text-foreground">
                {t("settings.hardware.detected.title")}
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetchSnapshot()}
                disabled={snapshotLoading}
              >
                <IconRefresh className="size-4 mr-1" />
                {t("settings.hardware.detected.refresh")}
              </Button>
            </div>

            <div className="rounded-md border border-border divide-y divide-border">
              {gpus.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t("settings.hardware.detected.emptyGpus")}
                </div>
              )}
              {gpus.map((gpu) => {
                const vram = formatVram(gpu.vramMB);
                return (
                  <div
                    key={gpu.index}
                    className="px-3 py-2 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground truncate">
                        #{gpu.index} · {gpu.model}
                      </div>
                      <div className="text-muted-foreground truncate">
                        {gpu.vendor}
                        {vram ? ` · ${vram}` : ""}
                        {gpu.dedicated
                          ? ` · ${t("settings.hardware.detected.dedicated")}`
                          : ` · ${t("settings.hardware.detected.integrated")}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 text-xs text-muted-foreground">
              {t("settings.hardware.detected.backends")}:{" "}
              {(snapshot?.availableBackends ?? ["cpu"]).join(", ")}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
