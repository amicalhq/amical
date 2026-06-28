import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/trpc/react";
import { useTranslation } from "react-i18next";
import { Cpu, AlertCircle } from "lucide-react";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { Tile, SkipPill } from "../shared/ui";
import { useApplyOnboardingModel } from "../shared/useApplyOnboardingModel";
import {
  findInstalledLocalModel,
  getAvailableModelName,
} from "@/constants/models";
import { OnboardingScreen } from "../../../../types/onboarding";

interface DownloadScreenProps {
  onNext: () => void;
  onBack: () => void;
}

const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)}`;

/**
 * Local setup step: download the recommended on-device speech model. Auto-starts
 * if no whisper model is present, streams progress, and unlocks Continue at
 * 100% (or immediately if a model is already installed). (Absorbs the local
 * branch of the former ModelSetupModal.)
 */
export function DownloadScreen({ onNext, onBack }: DownloadScreenProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState<{
    downloaded: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const { data: recommendedModelId } =
    api.onboarding.getRecommendedLocalModel.useQuery();
  const downloadModelMutation = api.models.downloadModel.useMutation();
  const { data: downloadedModels } = api.models.getDownloadedModels.useQuery();

  const installedModel = findInstalledLocalModel(downloadedModels);
  const ready = progress >= 100 || !!installedModel;
  const modelName =
    installedModel?.name ||
    installedModel?.id ||
    (recommendedModelId && getAvailableModelName(recommendedModelId)) ||
    "Whisper";

  api.models.onDownloadProgress.useSubscription(undefined, {
    onData: (data) => {
      if (data.modelId === recommendedModelId) {
        setProgress(data.progress.progress);
        setInfo({
          downloaded: data.progress.bytesDownloaded || 0,
          total: data.progress.totalBytes || 0,
        });
      }
    },
    onError: (err) => console.error("Download progress error:", err),
  });

  const startDownload = useCallback(async () => {
    if (!recommendedModelId) return;
    setError(null);
    try {
      await downloadModelMutation.mutateAsync({ modelId: recommendedModelId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t("onboarding.download.error", { message }));
    }
  }, [downloadModelMutation, recommendedModelId, t]);

  // Auto-start the download once, unless a whisper model is already installed.
  // Waits for the recommendation to resolve — starting against a fallback id
  // would download the wrong model and leave the progress subscription
  // filtering on the real one.
  useEffect(() => {
    if (!downloadedModels || !recommendedModelId || startedRef.current) return;
    startedRef.current = true;
    if (!findInstalledLocalModel(downloadedModels)) {
      void startDownload();
    }
  }, [downloadedModels, recommendedModelId, startDownload]);

  const pct = Math.round(progress);

  // Local model is selected once the download is ready, before the try-it segment.
  useApplyOnboardingModel(ready);

  return (
    <OnboardingLayout
      screen={OnboardingScreen.Download}
      title={t("onboarding.download.title")}
      subtitle={t("onboarding.download.subtitle")}
      footer={
        <NavigationButtons
          onBack={onBack}
          onNext={onNext}
          disableNext={!ready}
        />
      }
    >
      <div className="w-full max-w-[480px] animate-ob-rise rounded-2xl border border-border bg-card p-[22px]">
        <div className="mb-[17px] flex items-center gap-[13px]">
          <Tile className="size-11 bg-brand/10 text-brand dark:bg-brand/15">
            <Cpu size={22} />
          </Tile>
          <div>
            <b className="block text-sm font-semibold">{modelName}</b>
            <span className="text-[13px] text-muted-foreground">
              {t("onboarding.download.modelTag")}
            </span>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 text-[12.5px] leading-snug text-red-600 dark:text-red-400 [&_svg]:shrink-0">
            <AlertCircle size={16} />
            {error}
            <SkipPill className="ml-auto" onClick={() => void startDownload()}>
              {t("onboarding.download.retry")}
            </SkipPill>
          </div>
        ) : (
          <>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="block h-full rounded-full bg-gradient-to-r from-brand to-brand/70 transition-[width] duration-300 ease-linear"
                style={{ width: `${ready ? 100 : pct}%` }}
              />
            </div>
            <div className="mt-[9px] flex justify-between text-xs text-muted-foreground">
              <span>
                {installedModel
                  ? t("onboarding.download.alreadyInstalled")
                  : ready
                    ? t("onboarding.download.ready")
                    : `${pct}%`}
              </span>
              <span>
                {info
                  ? `${formatMB(info.downloaded)} / ${formatMB(info.total)} MB`
                  : ""}
              </span>
            </div>
          </>
        )}
      </div>
    </OnboardingLayout>
  );
}
