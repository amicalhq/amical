import React from "react";
import { NavigationButtons } from "../shared/NavigationButtons";

interface WelcomeScreenProps {
  onNext: () => void;
}

/**
 * Welcome screen - first screen users see in onboarding
 * Displays Vox logo and a continue action
 */
export function WelcomeScreen({ onNext }: WelcomeScreenProps) {
  return (
    <div className="flex h-full flex-col items-center bg-background px-6 py-4">
      <div className="w-full max-w-3xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Welcome to Vox
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Get Vox ready in a few quick steps.
        </p>
      </div>
      <div className="flex flex-1 w-full max-w-3xl items-center justify-center">
        <img src="assets/logo.svg" alt="Vox" className="h-28 w-28" />
      </div>
      <div className="w-full max-w-3xl pt-4 mt-auto">
        <NavigationButtons onNext={onNext} showBack={false} />
      </div>
    </div>
  );
}
