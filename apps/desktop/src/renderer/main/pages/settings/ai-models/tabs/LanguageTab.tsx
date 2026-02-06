"use client";
import { Card, CardContent } from "@/components/ui/card";
import SyncedModelsList from "../components/synced-models-list";

export default function LanguageTab() {
  return (
    <Card>
      <CardContent className="space-y-6 p-6">
        {/* Available Models List */}
        <SyncedModelsList title="Available Models" />
      </CardContent>
    </Card>
  );
}
