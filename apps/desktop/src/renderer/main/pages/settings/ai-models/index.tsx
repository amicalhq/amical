"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import SpeechTab from "./tabs/SpeechTab";
import LanguageTab from "./tabs/LanguageTab";
import EmbeddingTab from "./tabs/EmbeddingTab";
import { useNavigate, getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

const routeApi = getRouteApi("/settings/ai-models");

export default function AIModelsSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab } = routeApi.useSearch();

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">{t("settings.aiModels.title")}</h1>
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
            {t("settings.aiModels.tabs.speech")}
          </TabsTrigger>
          <TabsTrigger value="language" className="text-base">
            {t("settings.aiModels.tabs.language")}
          </TabsTrigger>
          <TabsTrigger value="embedding" className="text-base">
            {t("settings.aiModels.tabs.embedding")}
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
