"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion } from "@/components/ui/accordion";
import SyncedModelsList from "../components/synced-models-list";
import DefaultModelCombobox from "../components/default-model-combobox";
import ProviderAccordion from "../components/provider-accordion";
import { useTranslation } from "react-i18next";

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
          <ProviderAccordion provider="OpenRouter" modelType="language" />
          <ProviderAccordion provider="Ollama" modelType="language" />
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
