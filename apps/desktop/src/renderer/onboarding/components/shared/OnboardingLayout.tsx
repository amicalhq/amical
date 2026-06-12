import React from "react";
import { useTranslation } from "react-i18next";
import { ScreenHeader } from "./ui";
import {
  phaseLabelKey,
  SCREEN_PHASE,
} from "../../../../utils/onboarding-screens";
import type { OnboardingScreen } from "../../../../types/onboarding";

interface OnboardingLayoutProps {
  /** Optional decoration above the eyebrow (e.g. the completion celebrate mark). */
  badge?: React.ReactNode;
  /** The screen, from which the phase eyebrow (uppercase indigo label) is
   *  derived — single wayfinding vocabulary. */
  screen: OnboardingScreen;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Footer nav (Back + Continue). Pinned to the bottom of the screen. */
  footer?: React.ReactNode;
}

/**
 * Shared layout for the PASSIVE onboarding screens (usage, permissions,
 * discovery, model, sign-in, download, done) — the ones with a normal footer
 * Continue. Left-aligned eyebrow + display title + subtitle, then content, then
 * the footer pinned to the bottom. (Configure/try-it screens use SplitScreen.)
 */
export function OnboardingLayout({
  badge,
  screen,
  title,
  subtitle,
  children,
  footer,
}: OnboardingLayoutProps) {
  const { t } = useTranslation();
  const eyebrow = t(phaseLabelKey(SCREEN_PHASE[screen]));
  return (
    <section className="absolute inset-0 flex flex-col px-14 pt-[34px]">
      <div className="max-w-[560px] shrink-0 animate-ob-rise">
        {badge}
        <ScreenHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      </div>
      <div className="mt-[26px] flex min-h-0 flex-1 flex-col">{children}</div>
      {footer}
    </section>
  );
}
