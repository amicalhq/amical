"use client";

import { Accordion } from "@/components/ui/accordion";
import ProviderAccordion from "./components/provider-accordion";
import OfflineWhisperAccordion from "./components/offline-whisper-accordion";

const PROVIDERS = [
  {
    kind: "offline",
    provider: "Whisper (Offline)",
    capabilities: ["speech model"],
  },
  {
    provider: "OpenAI",
    modelType: "language",
    capabilities: ["formatting model", "speech model"],
  },
  {
    provider: "Anthropic",
    modelType: "language",
    capabilities: ["formatting model"],
  },
  { provider: "Google", modelType: "language", capabilities: ["formatting model"] },
  {
    provider: "OpenRouter",
    modelType: "language",
    capabilities: ["formatting model"],
  },
  { provider: "Ollama", modelType: "language", capabilities: ["formatting model"] },
  {
    provider: "Groq",
    modelType: "transcription",
    capabilities: ["speech model"],
  },
  {
    provider: "Grok",
    modelType: "transcription",
    capabilities: ["speech model"],
  },
] as const;

export default function AIModelsSettingsPage() {
  return (
    <div className="container mx-auto max-w-5xl px-6 pb-6">
      <div className="mb-8">
        <h1 className="text-xl font-bold">AI Models</h1>
      </div>

      <div className="space-y-10">
        <section className="space-y-4">
          <Accordion type="multiple" className="space-y-3">
            {PROVIDERS.map((provider) =>
              provider.kind === "offline" ? (
                <OfflineWhisperAccordion key={provider.provider} />
              ) : (
                <ProviderAccordion
                  key={provider.provider}
                  provider={provider.provider}
                  modelType={provider.modelType}
                  capabilities={[...provider.capabilities]}
                />
              ),
            )}
          </Accordion>
        </section>

      </div>
    </div>
  );
}
