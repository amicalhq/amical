"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion } from "@/components/ui/accordion";
import SyncedModelsList from "../components/synced-models-list";
import DefaultModelCombobox from "../components/default-model-combobox";
import ProviderAccordion from "../components/provider-accordion";
import { useTranslation } from "react-i18next";
import { REMOTE_PROVIDERS } from "@/constants/remote-providers";

export default function LanguageTab() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {/* Default model picker */}
        <DefaultModelCombobox
          modelType="language"
          title={t("settings.aiModels.defaultModels.language")}
        />

        {/* Providers Accordions */}
        <Accordion type="multiple" className="w-full">
          <ProviderAccordion
            provider={REMOTE_PROVIDERS.openRouter}
            modelType="language"
          />
          <ProviderAccordion
            provider={REMOTE_PROVIDERS.ollama}
            modelType="language"
          />
          <ProviderAccordion
            provider={REMOTE_PROVIDERS.openAICompatible}
            modelType="language"
          />
        </Accordion>

        {/* Synced Models List */}
        <SyncedModelsList
          modelType="language"
          title={t("settings.aiModels.syncedModels.title")}
        />
      </CardContent>
    </Card>
  );
}
