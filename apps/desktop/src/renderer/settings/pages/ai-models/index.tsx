"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import SpeechTab from "./tabs/SpeechTab";
import LanguageTab from "./tabs/LanguageTab";
import EmbeddingTab from "./tabs/EmbeddingTab";

export default function AIModelsSettingsPage() {
  const [tab, setTab] = useState("speech");
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
