import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { OnboardingLayout } from "../shared/OnboardingLayout";
import { NavigationButtons } from "../shared/NavigationButtons";
import { ModelSetupModal } from "./ModelSetupModal";
import { useSystemRecommendation } from "../../hooks/useSystemRecommendation";
import { ModelType } from "../../../../types/onboarding";
import { Cloud, Laptop, Sparkles, Check, X, Star } from "lucide-react";
import { toast } from "sonner";

interface ModelSelectionScreenProps {
  onNext: (modelType: ModelType, recommendationFollowed: boolean) => void;
  onBack: () => void;
  initialSelection?: ModelType;
}

/**
 * Model selection screen - allows users to choose between cloud and local models
 */
export function ModelSelectionScreen({
  onNext,
  onBack,
  initialSelection,
}: ModelSelectionScreenProps) {
  const { recommendation, isLoading } = useSystemRecommendation();
  const [selectedModel, setSelectedModel] = useState<ModelType | null>(
    initialSelection || null,
  );
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupComplete, setSetupComplete] = useState<{
    [ModelType.Cloud]: boolean;
    [ModelType.Local]: boolean;
  }>({
    [ModelType.Cloud]: false,
    [ModelType.Local]: false,
  });

  const models = [
    {
      id: ModelType.Cloud,
      title: "Amical Cloud",
      subtitle: "Fast, more accurate, and free - no setup needed",
      description:
        "Ideal if you want the best accuracy or your device can't run local models.\nSecure processing; audio is never stored.",
      pros: ["Free", "Fast", "More accurate", "No setup needed"],
      cons: ["Needs internet & login"],
      icon: Cloud,
      iconBg: "bg-blue-500/10",
      iconColor: "text-blue-500",
    },
    {
      id: ModelType.Local,
      title: "Local Models",
      subtitle: "Private, offline, and free - runs fully on your device.",
      description:
        "Great for privacy-focused users with capable hardware. No login required.",
      pros: ["Full privacy", "Works offline"],
      cons: ["Uses device resources"],
      icon: Laptop,
      iconBg: "bg-slate-500/10",
      iconColor: "text-slate-500",
    },
  ];

  const handleModelSelect = (modelType: ModelType) => {
    setSelectedModel(modelType);
    setShowSetupModal(true);
  };

  const handleSetupComplete = () => {
    if (selectedModel) {
      setSetupComplete((prev) => ({
        ...prev,
        [selectedModel]: true,
      }));
    }
  };

  const handleContinue = () => {
    if (!selectedModel) {
      toast.error("Please select a model type");
      return;
    }

    if (!setupComplete[selectedModel]) {
      toast.error("Please complete setup to continue");
      return;
    }

    const followedRecommendation = recommendation?.suggested === selectedModel;
    onNext(selectedModel, followedRecommendation);
  };

  // Check if any setup is complete
  const canContinue = selectedModel && setupComplete[selectedModel];

  return (
    <OnboardingLayout
      title="Choose Your AI Model"
      subtitle="Select how you want Vox to process your audio"
      footer={
        <NavigationButtons
          onBack={onBack}
          onNext={handleContinue}
          disableNext={!canContinue}
          nextLabel={canContinue ? "Continue" : "Complete setup to continue"}
        />
      }
    >
      <div className="space-y-4">
        {/* System Recommendation */}
        {recommendation && !isLoading && (
          <Alert className="border-primary/50 bg-primary/5">
            <Sparkles className="h-4 w-4" />
            <AlertDescription>
              <div>
                <span className="font-medium">Recommendation:</span> Based on
                your system specs, we recommend{" "}
                <span className="font-medium whitespace-nowrap">
                  {recommendation.suggested === ModelType.Cloud
                    ? "Amical Cloud"
                    : "Local Models"}
                </span>
                .
              </div>
              <div className="mt-1">{recommendation.reason}</div>
            </AlertDescription>
          </Alert>
        )}

        {/* Model Options */}
        <div className="space-y-4">
          {models.map((model) => {
            const Icon = model.icon;
            const isSelected = selectedModel === model.id;
            const isRecommended = recommendation?.suggested === model.id;
            const isComplete = setupComplete[model.id];

            return (
              <Card
                key={model.id}
                className={`cursor-pointer transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/50"
                }`}
                onClick={() => handleModelSelect(model.id)}
              >
                <div className="flex items-start gap-4 px-4">
                  <div className="flex-1 space-y-2">
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`rounded-lg p-2 ${model.iconBg}`}>
                          <Icon className={`h-6 w-6 ${model.iconColor}`} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{model.title}</h3>
                            {isRecommended && (
                              <Badge variant="secondary" className="text-xs">
                                Recommended
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm">{model.subtitle}</p>
                        </div>
                      </div>
                      {isComplete && (
                        <div className="rounded-full bg-green-500/10 p-1">
                          <Check className="h-4 w-4 text-green-500" />
                        </div>
                      )}
                    </div>

                    {/* Description */}
                    <p className="text-sm text-muted-foreground whitespace-pre-line">
                      {model.description}
                    </p>

                    {/* Pros and Cons */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="mb-1 font-medium text-green-600 dark:text-green-400">
                          Pros:
                        </p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {model.pros.map((pro, i) => (
                            <li key={i} className="flex items-center gap-1.5">
                              <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                              {pro}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="mb-1 font-medium text-orange-600 dark:text-orange-400">
                          Cons:
                        </p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {model.cons.map((con, i) => (
                            <li key={i} className="flex items-center gap-1.5">
                              <X className="h-3.5 w-3.5 text-red-500 shrink-0" />
                              {con}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Settings Note */}
        <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-4">
          <Star className="h-4 w-4 mt-0.5 text-yellow-500 shrink-0 " />
          <p className="text-sm text-muted-foreground">
            You can change your model later in Settings — nothing is permanent.
          </p>
        </div>
      </div>

      {/* Setup Modal */}
      {selectedModel && (
        <ModelSetupModal
          isOpen={showSetupModal}
          onClose={(wasCompleted) => {
            setShowSetupModal(false);
            // Deselect if setup wasn't completed
            if (!wasCompleted && !setupComplete[selectedModel]) {
              setSelectedModel(null);
            }
          }}
          modelType={selectedModel}
          onContinue={() => {
            handleSetupComplete();
            const followedRecommendation =
              recommendation?.suggested === selectedModel;
            onNext(selectedModel, followedRecommendation);
          }}
        />
      )}
    </OnboardingLayout>
  );
}
