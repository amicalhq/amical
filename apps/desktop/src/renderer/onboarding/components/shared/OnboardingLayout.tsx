import React from "react";
import { cn } from "@/lib/utils";

interface OnboardingLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  className?: string;
}

/**
 * Shared layout component for all onboarding screens
 * Provides consistent structure and styling
 */
export function OnboardingLayout({
  children,
  title,
  subtitle,
  className,
}: OnboardingLayoutProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center bg-background py-4 px-6",
        className,
      )}
    >
      <div className="w-full max-w-3xl">
        {/* Header */}
        {(title || subtitle) && (
          <div className="mb-4 text-center">
            {title && (
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="mt-2 text-base text-muted-foreground">{subtitle}</p>
            )}
          </div>
        )}

        {/* Content */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
