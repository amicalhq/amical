import { AdvancedSettingsContent } from "./AdvancedSettingsContent";

export default function AdvancedSettingsPage() {
  return (
    <div className="container mx-auto p-6 max-w-5xl">
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
