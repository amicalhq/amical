"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import SpeechTab from "./tabs/SpeechTab";
import LanguageTab from "./tabs/LanguageTab";
import EmbeddingTab from "./tabs/EmbeddingTab";
import { useNavigate, getRouteApi } from "@tanstack/react-router";

const routeApi = getRouteApi("/settings/ai-models");

export default function AIModelsSettingsPage() {
  const navigate = useNavigate();
  const { tab } = routeApi.useSearch();

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-6">AI Models</h1>
      <Tabs
        value={tab}
        onValueChange={(newTab) => {
          navigate({
            to: "/settings/ai-models",
            search: { tab: newTab as "speech" | "language" | "embedding" },
          });
        }}
        className="w-full"
      >
        <TabsList className="mb-6">
          <TabsTrigger value="speech" className="text-base">
            Speech
          </TabsTrigger>
          <TabsTrigger value="language" className="text-base">
            Language
          </TabsTrigger>
          <TabsTrigger value="embedding" className="text-base">
            Embedding
          </TabsTrigger>
        </TabsList>
        <TabsContent value="speech">
          <SpeechTab />
        </TabsContent>
        <TabsContent value="language">
          <LanguageTab />
        </TabsContent>
        <TabsContent value="embedding">
          <EmbeddingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
