"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import SpeechTab from "./tabs/SpeechTab";
import LanguageTab from "./tabs/LanguageTab";
import EmbeddingTab from "./tabs/EmbeddingTab";
import { useSearchParams } from "react-router-dom";

export default function AIModelsSettingsPage() {
  const [tab, setTab] = useState("speech");
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab) {
      setTab(tab);
    }
  }, []);

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-6">AI Models</h1>
      <Tabs value={tab} onValueChange={setTab} className="w-full">
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
