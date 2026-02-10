import { AdvancedSettingsContent } from "./AdvancedSettingsContent";

export default function AdvancedSettingsPage() {
  return (
    <div className="container mx-auto max-w-5xl px-6 pb-6">
      <div className="mb-8">
        <h1 className="text-xl font-bold">Advanced</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Advanced configuration options and experimental features
        </p>
      </div>
      <AdvancedSettingsContent />
    </div>
  );
}
