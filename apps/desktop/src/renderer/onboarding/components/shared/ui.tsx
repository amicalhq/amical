import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Onboarding UI primitives, Tailwind-composed (shadcn-style). Surfaces and
 * text use the app's semantic tokens so light/dark just work; the accent is
 * stock indigo per the locked mock (design/onboarding-mock.html).
 */

export const obButtonVariants = cva(
  "inline-flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-full px-[22px] py-3 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 enabled:hover:-translate-y-px enabled:hover:bg-indigo-600 enabled:hover:shadow-indigo-500/40",
        soft: "border border-border bg-secondary text-foreground enabled:hover:border-neutral-300 enabled:hover:bg-muted dark:enabled:hover:border-neutral-600",
        ghost:
          "px-3 text-muted-foreground enabled:hover:bg-secondary enabled:hover:text-foreground",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function ObButton({
  className,
  variant,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof obButtonVariants>) {
  return (
    <button
      type={type}
      className={cn(obButtonVariants({ variant }), className)}
      {...props}
    />
  );
}

export function SkipPill({
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "cursor-pointer rounded-full border border-border px-4 py-[9px] text-[13px] font-semibold text-muted-foreground/80 transition-colors duration-200 hover:border-neutral-300 hover:text-muted-foreground dark:hover:border-neutral-600",
        className,
      )}
      {...props}
    />
  );
}

/** Selectable pill chip (welcome use cases, discovery sources). Selection is
 * the indigo tint — no checkmark, so the pill never changes width. */
export function SelectChip({
  selected,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "inline-flex cursor-pointer items-center gap-[7px] rounded-full border px-4 py-2.5 text-sm font-medium transition-colors duration-150",
        selected
          ? "border-indigo-500/35 bg-indigo-500/10 text-indigo-700 dark:border-indigo-500/45 dark:bg-indigo-500/15 dark:text-white"
          : "border-border bg-card text-foreground hover:border-neutral-300 dark:hover:border-neutral-600",
        className,
      )}
      {...props}
    />
  );
}

/** Icon tile used on option cards, permission rows, and summary rows. */
export function Tile({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Card row: icon tile + bold title + muted description + a trailing status
 * (permission rows, completion summary rows). Spacing/tile size vary per
 * screen, so they come in via classNames. */
export function InfoRow({
  className,
  tileClassName,
  icon,
  title,
  description,
  trailing,
}: {
  className?: string;
  tileClassName?: string;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  trailing: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <Tile className={tileClassName}>{icon}</Tile>
      <div className="flex-1">
        <b className="block text-sm font-semibold">{title}</b>
        <span className="text-[13px] text-muted-foreground">{description}</span>
      </div>
      {trailing}
    </div>
  );
}

/** Eyebrow (phase label) + display title + optional subtitle. */
export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div>
      <span className="mb-[13px] flex w-fit items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-indigo-500 before:h-[1.5px] before:w-[18px] before:rounded-full before:bg-indigo-500/45 before:content-['']">
        {eyebrow}
      </span>
      <h1 className="text-[34px] font-bold leading-[1.08] tracking-[-0.01em]">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-[11px] max-w-[520px] text-base leading-normal text-muted-foreground">
          {subtitle}
        </p>
      )}
    </div>
  );
}
