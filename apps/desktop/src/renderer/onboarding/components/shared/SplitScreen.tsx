import React from "react";
import { useTranslation } from "react-i18next";
import { ScreenHeader } from "./ui";
import {
  phaseLabelKey,
  SCREEN_PHASE,
} from "../../../../utils/onboarding-screens";
import type { OnboardingScreen } from "../../../../types/onboarding";

/**
 * The Configure / try-it screen anatomy (mic, shortcut, language, dictation):
 * a left rail (phase eyebrow + title + subtitle + one passive hint) and a
 * right instrument area (PreviewPanel card or the dictation sheet) holding
 * the in-card action row (gated on some steps, e.g. dictation). The footer
 * (rendered by the screen) is Back-(+Skip-)only — the advance always lives
 * in the card.
 */
export function SplitScreen({
  screen,
  title,
  subtitle,
  hint,
  children,
  footer,
}: {
  /** The screen, from which the phase eyebrow is derived. */
  screen: OnboardingScreen;
  title: string;
  subtitle?: string;
  hint?: React.ReactNode;
  /** The right-hand instrument (preview card or sheet). */
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const eyebrow = t(phaseLabelKey(SCREEN_PHASE[screen]));
  return (
    <section className="absolute inset-0 flex flex-col px-14 pt-[34px]">
      <div className="mt-[26px] flex min-h-0 flex-1 flex-col">
        <div className="grid size-full animate-ob-rise grid-cols-[minmax(0,440px)_1fr] items-center gap-10">
          <div className="flex flex-col">
            <ScreenHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
            {hint && (
              <div className="mt-6 flex items-start gap-[9px] text-[13px] leading-snug text-muted-foreground [&_svg]:mt-px [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-indigo-500">
                {hint}
              </div>
            )}
          </div>
          {children}
        </div>
      </div>
      {footer}
    </section>
  );
}

/** The atmospheric right-hand card that holds the instrument + verdict + actions. */
export function PreviewPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-[380px] flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-muted to-background p-7">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_300px_at_70%_0%,rgba(99,102,241,0.14),transparent_60%),radial-gradient(500px_360px_at_20%_100%,rgba(99,102,241,0.07),transparent_55%)]"
        aria-hidden
      />
      {children}
    </div>
  );
}

/**
 * The single verdict line under every instrument: a green pulse dot + the
 * verify-by-eye prompt. These steps gate on the user's judgment, not on a
 * detected state, so there is no programmatic "passed" rendering.
 */
export function Verdict({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-5 items-center gap-[7px] text-center text-[13.5px] font-medium text-muted-foreground">
      <span className="size-[7px] rounded-full bg-emerald-600 dark:bg-emerald-400" />
      <span>{children}</span>
    </div>
  );
}

/** The `[Change X] [advance]` row inside the preview card. */
export function CardActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mt-1 flex items-center gap-2.5">{children}</div>
  );
}
