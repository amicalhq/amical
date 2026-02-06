"use client";

import { Accordion } from "@/components/ui/accordion";
import ProviderAccordion from "./components/provider-accordion";
import OfflineWhisperAccordion from "./components/offline-whisper-accordion";

const PROVIDERS = [
  {
    kind: "offline",
    provider: "Whisper (Offline)",
    capabilities: ["Speech-to-Text"],
  },
  {
    provider: "OpenAI",
    modelType: "language",
    capabilities: ["LLM", "Speech-to-Text"],
  },
  { provider: "Anthropic", modelType: "language", capabilities: ["LLM"] },
  { provider: "Google", modelType: "language", capabilities: ["LLM"] },
  { provider: "OpenRouter", modelType: "language", capabilities: ["LLM"] },
  { provider: "Ollama", modelType: "language", capabilities: ["LLM"] },
  {
    provider: "Groq",
    modelType: "transcription",
    capabilities: ["Speech-to-Text"],
  },
  {
    provider: "Grok",
    modelType: "transcription",
    capabilities: ["Speech-to-Text"],
  },
] as const;

export default function AIModelsSettingsPage() {
  return (
    <div className="container mx-auto p-6 max-w-5xl">
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
