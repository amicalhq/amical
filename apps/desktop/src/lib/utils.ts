import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date): string {
  const now = new Date();
  const resolvedLocale =
    typeof navigator !== "undefined"
      ? navigator.language
      : Intl.DateTimeFormat().resolvedOptions().locale;

  const rtf = new Intl.RelativeTimeFormat(resolvedLocale, { numeric: "auto" });

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDate = new Date(date);
  startOfDate.setHours(0, 0, 0, 0);
  const diffInDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffInDays === 0) return rtf.format(0, "day");
  if (diffInDays === 1) return rtf.format(-1, "day");

  return new Intl.DateTimeFormat(resolvedLocale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  }).format(date);
}
