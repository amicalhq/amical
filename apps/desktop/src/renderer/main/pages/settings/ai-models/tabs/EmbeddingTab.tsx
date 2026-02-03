"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion } from "@/components/ui/accordion";
import SyncedModelsList from "../components/synced-models-list";
import DefaultModelCombobox from "../components/default-model-combobox";
import ProviderAccordion from "../components/provider-accordion";
import { useTranslation } from "react-i18next";

// Note: OpenRouter doesn't provide embedding models, only Ollama for now

export default function EmbeddingTab() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {/* Default model picker */}
        <DefaultModelCombobox
          modelType="embedding"
          title={t("settings.aiModels.defaultModels.embedding")}
        />

        {/* Providers Accordions */}
        <Accordion type="multiple" className="w-full">
          <ProviderAccordion provider="Ollama" modelType="embedding" />
        </Accordion>

        {/* Synced Models List */}
        <SyncedModelsList
          modelType="embedding"
          title={t("settings.aiModels.syncedModels.title")}
        />
      </CardContent>
    </Card>
  );
}
