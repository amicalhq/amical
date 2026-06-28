import { useState } from "react";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { Tile } from "../shared/ui";
import { cn } from "@/lib/utils";
import { useSystemRecommendation } from "../../hooks/useSystemRecommendation";
import { useLocalTranscriptionSupported } from "@/hooks/useLocalTranscriptionSupported";
import {
  ModelType,
  OnboardingScreen,
  type ModelRecommendation,
} from "../../../../types/onboarding";
import { Cloud, Cpu, Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ModelSelectionScreenProps {
  onNext: (
    modelType: ModelType,
    recommendation?: ModelRecommendation & { followed: boolean },
  ) => void;
  onBack: () => void;
  initialSelection?: ModelType;
}

const cardClass = (selected: boolean, locked = false) =>
  cn(
    "relative rounded-2xl border p-[22px] text-left transition-all duration-200",
    locked
      ? "cursor-not-allowed border-border bg-card opacity-55"
      : selected
        ? "cursor-pointer border-brand/35 bg-brand/10 dark:border-brand/45 dark:bg-brand/15"
        : "cursor-pointer border-border bg-card hover:border-neutral-300 hover:bg-secondary/60 dark:hover:border-neutral-600",
  );

/** Benefit line (green check) — `lead` bolds the card's headline benefit. */
function BulletLine({ text, lead = false }: { text: string; lead?: boolean }) {
  return (
    <li className="flex items-start gap-[9px] text-[13px] leading-snug text-muted-foreground">
      <Check
        size={15}
        className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400"
      />
      <span>
        {lead ? <b className="font-semibold text-foreground">{text}</b> : text}
      </span>
    </li>
  );
}

/** Caveat line (quiet dot) — `lead` bolds the card's headline caveat. */
function CaveatLine({ text, lead = false }: { text: string; lead?: boolean }) {
  return (
    <li className="flex items-start gap-[9px] text-[13px] leading-snug text-muted-foreground/70">
      <span className="w-[15px] shrink-0 text-center font-bold">·</span>
      <span>
        {lead ? <b className="font-semibold text-foreground">{text}</b> : text}
      </span>
    </li>
  );
}

/**
 * Model selection screen — records the user's choice between Cloud and Local.
 * Setup (sign-in / download) runs on a later screen, so this one only captures
 * the choice and advances. Keeps the system recommendation + local-support gate.
 */
export function ModelSelectionScreen({
  onNext,
  onBack,
  initialSelection,
}: ModelSelectionScreenProps) {
  const { t } = useTranslation();
  const { recommendation } = useSystemRecommendation();
  const { localSupported } = useLocalTranscriptionSupported();

  // Product decision: the UI recommends Cloud for now regardless of hardware.
  // The system recommendation rides along in telemetry only (suggested +
  // followed, resolved in handleNext).
  const [selectedModel, setSelectedModel] = useState<ModelType>(
    initialSelection ?? ModelType.Cloud,
  );

  // i18next returns the key string (not an array) when a key is missing or
  // when returnObjects is unsupported, so guard before iterating to avoid a
  // render-time `.map`/`.slice` crash on locales that drift from `en`.
  const toStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? (value as string[]) : [];

  const cloudBullets = toStringArray(
    t("onboarding.modelSelection.cards.cloud.bullets", {
      returnObjects: true,
    }),
  );
  const localBullets = toStringArray(
    t("onboarding.modelSelection.cards.local.bullets", {
      returnObjects: true,
    }),
  );
  const localCaveats = toStringArray(
    t("onboarding.modelSelection.cards.local.caveats", {
      returnObjects: true,
    }),
  );

  const handleSelect = (modelType: ModelType) => {
    if (modelType === ModelType.Local && !localSupported) return;
    setSelectedModel(modelType);
  };

  const handleNext = () => {
    // Pass the full recommendation so it persists with the choice — followed
    // is meaningless in telemetry without what was suggested.
    onNext(
      selectedModel,
      recommendation
        ? {
            ...recommendation,
            followed: recommendation.suggested === selectedModel,
          }
        : undefined,
    );
  };

  return (
    <OnboardingLayout
      screen={OnboardingScreen.ModelSelection}
      title={t("onboarding.modelSelection.title")}
      subtitle={t("onboarding.modelSelection.subtitle")}
      footer={<NavigationButtons onBack={onBack} onNext={handleNext} />}
    >
      <div className="grid w-full max-w-[700px] animate-ob-rise grid-cols-2 gap-4">
        <button
          type="button"
          className={cardClass(selectedModel === ModelType.Cloud)}
          onClick={() => handleSelect(ModelType.Cloud)}
        >
          <span className="absolute right-[18px] top-[18px] rounded-full bg-brand/10 px-[9px] py-[5px] text-[10px] font-bold uppercase tracking-wider text-brand dark:bg-brand/15">
            {t("onboarding.modelSelection.recommended")}
          </span>
          <div className="mb-3.5 flex items-center gap-3">
            <Tile
              className={cn(
                "size-[42px]",
                selectedModel === ModelType.Cloud &&
                  "bg-brand/10 text-brand dark:bg-brand/15",
              )}
            >
              <Cloud size={20} />
            </Tile>
            <div>
              <h3 className="text-xl font-bold">
                {t("onboarding.modelSelection.cards.cloud.name")}
              </h3>
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                {t("onboarding.modelSelection.cards.cloud.tag")}
              </div>
            </div>
          </div>
          <ul className="mt-1 flex flex-col gap-[9px]">
            {cloudBullets.map((bullet, i) => (
              <BulletLine key={i} text={bullet} lead={i === 0} />
            ))}
            <CaveatLine
              text={t("onboarding.modelSelection.cards.cloud.caveat")}
            />
          </ul>
        </button>

        <button
          type="button"
          className={cardClass(
            selectedModel === ModelType.Local,
            !localSupported,
          )}
          disabled={!localSupported}
          onClick={() => handleSelect(ModelType.Local)}
        >
          <div className="mb-3.5 flex items-center gap-3">
            <Tile
              className={cn(
                "size-[42px]",
                localSupported &&
                  selectedModel === ModelType.Local &&
                  "bg-brand/10 text-brand dark:bg-brand/15",
              )}
            >
              <Cpu size={20} />
            </Tile>
            <div>
              <h3 className="text-xl font-bold">
                {t("onboarding.modelSelection.cards.local.name")}
              </h3>
              {localSupported ? (
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {t("onboarding.modelSelection.cards.local.tag")}
                </div>
              ) : (
                <div className="mt-0.5 inline-flex items-center gap-[5px] text-[13px] font-medium text-amber-600 dark:text-amber-400">
                  <Lock size={12} />
                  {t("onboarding.modelSelection.localUnsupported")}
                </div>
              )}
            </div>
          </div>
          <ul className="mt-1 flex flex-col gap-[9px]">
            {localBullets.map((bullet, i) => (
              <BulletLine key={i} text={bullet} />
            ))}
            <CaveatLine
              text={t("onboarding.modelSelection.cards.local.caveatLead")}
              lead
            />
            {localCaveats.map((caveat, i) => (
              <CaveatLine key={i} text={caveat} />
            ))}
          </ul>
        </button>
      </div>
    </OnboardingLayout>
  );
}
