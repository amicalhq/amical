import React from "react";
import { Button } from "@/components/ui/button";
import { LicenseCard } from "../shared/LicenseCard";

interface WelcomeScreenProps {
  onStart: () => void;
  cardHolderName: string;
}

/**
 * Welcome screen - first screen users see in onboarding
 * Displays welcome copy, license card, and start action.
 */
export function WelcomeScreen({ onStart, cardHolderName }: WelcomeScreenProps) {
  return (
    <div className="flex h-full items-center bg-background px-6 pb-4">
      <div className="mx-auto flex h-[640px] max-h-full w-full max-w-3xl flex-col justify-center">
        <div className="pt-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Welcome to Grizzo
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            Get Grizzo ready in a few quick steps.
          </p>
        </div>

        <div className="min-h-2 flex-1" />

        <div className="relative w-full self-center max-w-[560px]">
          <LicenseCard cardHolderName={cardHolderName} floating={false} />
        </div>

        <div className="min-h-2 flex-1" />

        <div className="flex justify-center">
          <Button
            onClick={onStart}
            type="button"
            className="h-12 min-w-40 rounded-full px-9 text-lg"
          >
            Start
          </Button>
        </div>
      </div>
    </div>
  );
}
