import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Progress } from "@/components/ui/progress";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDocumentVisible } from "@/renderer/main/hooks/use-document-visible";
import { api } from "@/trpc/react";
import { BILLING_RETURN_PATH } from "@/constants/web-app";

/** From this share of the allowance used, the meter warns. */
const NEAR_LIMIT_RATIO = 0.8;
/** At and above this many words left, the line uses compact numbers. */
const COMPACT_FROM = 10_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const METER_CLASS =
  "-mx-2 block rounded-md px-2 pt-1 pb-2 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring";

/** "in 13 hours" or "in 3 days" within a week of the reset; else null. */
function formatResetSoon(language: string, resetsAt: string): string | null {
  const ms = Date.parse(resetsAt) - Date.now();
  if (ms <= 0 || ms >= 7 * DAY_MS) return null;
  const relative = new Intl.RelativeTimeFormat(language);
  if (ms < DAY_MS) {
    return relative.format(Math.max(1, Math.round(ms / HOUR_MS)), "hour");
  }
  return relative.format(Math.round(ms / DAY_MS), "day");
}

// Rendered when the tooltip opens, so the relative time is current.
function ResetDetail({
  used,
  limit,
  resetsAt,
  dateDetail,
}: {
  used: string;
  limit: string;
  resetsAt: string;
  dateDetail: string;
}) {
  const { t, i18n } = useTranslation();
  const when = formatResetSoon(i18n.language, resetsAt);
  return when
    ? t("settings.sidebar.usage.detailRelative", { used, limit, when })
    : dateDetail;
}

// The meter counts cloud words only, so it reads usage only while the cloud
// speech model is selected.
export function UsageMeter() {
  const utils = api.useUtils();
  const speechModelQuery = api.models.getDefaultModel.useQuery({
    type: "speech",
  });
  api.models.onSelectionChanged.useSubscription(undefined, {
    onData: ({ modelType }) => {
      if (modelType === "speech") {
        void utils.models.getDefaultModel.invalidate({ type: "speech" });
      }
    },
  });
  return speechModelQuery.data === "amical-cloud" ? <CloudUsageMeter /> : null;
}

// Cloud word allowance at the foot of the sidebar. Every display decision
// (whether to draw, whether to offer an upgrade) comes from the server.
function CloudUsageMeter() {
  const { t, i18n } = useTranslation();
  const utils = api.useUtils();
  const visible = useDocumentVisible();

  const usageQuery = api.usage.get.useQuery(undefined, {
    networkMode: "always",
  });
  api.usage.onChanged.useSubscription(
    { visible },
    {
      onData: async () => {
        await utils.usage.get.cancel();
        await utils.usage.get.invalidate();
      },
    },
  );
  const { mutate: refreshIfStale } = api.usage.refreshIfStale.useMutation({
    networkMode: "always",
  });
  useEffect(() => {
    const onFocus = () => refreshIfStale();
    if (visible) onFocus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [visible, refreshIfStale]);

  const openWebSession = api.auth.openWebSession.useMutation({
    onError: (error) => {
      toast.error(t("settings.sidebar.usage.openFailed"), {
        description: error.message,
      });
    },
  });

  const usage = usageQuery.data;
  const cloudWords = usage?.cloudWords;
  if (!usage || !cloudWords) return null;
  // The main process stops serving a reset window, but this cached copy
  // lives until the next read: never draw an old window's numbers.
  if (Date.parse(cloudWords.resetsAt) <= Date.now()) return null;

  const { limit } = cloudWords;
  const used = Math.min(cloudWords.used, limit);
  const remaining = limit - used;
  const exhausted = remaining === 0;
  const low = !exhausted && used >= limit * NEAR_LIMIT_RATIO;
  // Literal class names, so Tailwind finds them.
  const [textTone, barTone] = exhausted
    ? [
        "text-destructive-foreground",
        "[&>[data-slot=progress-indicator]]:bg-destructive-foreground",
      ]
    : low
      ? ["text-warn", "[&>[data-slot=progress-indicator]]:bg-warn"]
      : ["text-muted-foreground", undefined];
  const canManage = usage.billing.canManage;
  const showUpgrade = canManage && usage.offers.premiumUpgrade;

  const fullNumber = new Intl.NumberFormat(i18n.language);
  const leftNumber =
    remaining >= COMPACT_FROM
      ? new Intl.NumberFormat(i18n.language, {
          notation: "compact",
          maximumFractionDigits: 0,
        })
      : fullNumber;
  const leftText = exhausted
    ? t("settings.sidebar.usage.noWordsLeft")
    : t("settings.sidebar.usage.wordsLeft", {
        count: remaining,
        words: leftNumber.format(remaining),
      });
  const usedText = fullNumber.format(used);
  const limitText = fullNumber.format(limit);
  // The exact date: the screen-reader label, and the tooltip a week out.
  const dateDetail = t("settings.sidebar.usage.detail", {
    used: usedText,
    limit: limitText,
    date: new Intl.DateTimeFormat(i18n.language, {
      month: "short",
      day: "numeric",
    }).format(new Date(cloudWords.resetsAt)),
  });
  const openBilling = () =>
    openWebSession.mutate({
      returnPath: `${BILLING_RETURN_PATH}?from=desktop_meter`,
    });

  const meter = (
    <>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate text-muted-foreground">
          {t("settings.sidebar.usage.label")}
        </span>
        <span className={cn("shrink-0 tabular-nums", textTone)}>
          {leftText}
        </span>
      </div>
      <Progress
        value={(used / limit) * 100}
        getValueLabel={() => dateDetail}
        className={cn("mt-1.5 h-1 bg-sidebar-foreground/20", barTone)}
      />
    </>
  );

  return (
    <SidebarMenuItem className="px-2 pb-1">
      <Tooltip>
        <TooltipTrigger asChild>
          {canManage ? (
            <button
              type="button"
              onClick={openBilling}
              disabled={openWebSession.isPending}
              className={cn(
                METER_CLASS,
                "w-[calc(100%+1rem)] text-left transition-colors hover:bg-sidebar-accent",
              )}
            >
              {meter}
            </button>
          ) : (
            <div tabIndex={0} className={METER_CLASS}>
              {meter}
            </div>
          )}
        </TooltipTrigger>
        <TooltipContent side="top">
          <ResetDetail
            used={usedText}
            limit={limitText}
            resetsAt={cloudWords.resetsAt}
            dateDetail={dateDetail}
          />
        </TooltipContent>
      </Tooltip>
      {/* An offer, not an alert: never in the warning colours. */}
      {showUpgrade ? (
        <button
          type="button"
          onClick={openBilling}
          disabled={openWebSession.isPending}
          className="mb-1 text-[11px] text-sidebar-foreground hover:underline"
        >
          {t("settings.sidebar.usage.upgradeUnlimited")}
        </button>
      ) : null}
    </SidebarMenuItem>
  );
}
