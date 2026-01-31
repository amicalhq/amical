"use client";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion } from "@/components/ui/accordion";
import SyncedModelsList from "../components/synced-models-list";
import DefaultModelCombobox from "../components/default-model-combobox";
import ProviderAccordion from "../components/provider-accordion";

export default function LanguageTab() {
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {/* Default model picker */}
        <DefaultModelCombobox
          modelType="language"
          title="Default Language Model"
        />

        {/* Providers Accordions */}
        <Accordion type="multiple" className="w-full">
          <ProviderAccordion provider="OpenRouter" modelType="language" />
          <ProviderAccordion provider="Ollama" modelType="language" />
          <ProviderAccordion provider="OpenAI" modelType="language" />
          <ProviderAccordion provider="Anthropic" modelType="language" />
          <ProviderAccordion provider="Google" modelType="language" />
        </Accordion>

        {/* Synced Models List */}
        <SyncedModelsList modelType="language" title="Synced Models" />
      </CardContent>
    </Card>
  );
}
