import React, { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WidgetFeedButton, WidgetFeedItem } from "@/types/widget-feed";
import { setPassThroughReason } from "../pass-through";

const BUTTON_CLASS =
  "max-w-full truncate rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors";

// The same dark glass as the FAB pill, in a card shape.
const CARD_SHELL_CLASS =
  "relative overflow-hidden rounded-xl bg-black/80 backdrop-blur-md ring-[1px] ring-black/60 shadow-[0px_0px_15px_0px_rgba(0,0,0,0.40)] before:content-[''] before:absolute before:inset-[1px] before:rounded-[11px] before:outline before:outline-white/15 before:pointer-events-none";

export interface WidgetFeedCardProps {
  item: WidgetFeedItem;
  // Time already used of `item.timeoutMs`, when the card mounts.
  timerElapsedMs: number;
  hovered: boolean;
  onHoverChange: (hovered: boolean) => void;
  onButton: (button: WidgetFeedButton) => void;
  onClose: () => void;
}

/**
 * The notification card above the FAB: image, copy and ✕ in a row, the item's
 * buttons under the copy, and a 2px bar for the time left. It is as large as
 * its copy needs, from 320 to 440px wide and at most as tall as its slot;
 * longer copy scrolls. A click on the card runs its first link button.
 */
export const WidgetFeedCard: React.FC<WidgetFeedCardProps> = ({
  item,
  timerElapsedMs,
  hovered,
  onHoverChange,
  onButton,
  onClose,
}) => {
  const { t } = useTranslation();
  // Read once: a later render must not move the bar.
  const [timerDelayMs] = useState(() => -timerElapsedMs);
  const [imageFailed, setImageFailed] = useState(false);
  const link = item.buttons.find((button) => button.action !== "dismiss");

  // The window takes clicks only while the pointer is on the card. A card that
  // goes away under the pointer must not keep the window clickable.
  const setHovered = (value: boolean) => {
    setPassThroughReason("feed", value);
    onHoverChange(value);
  };
  useEffect(() => () => setPassThroughReason("feed", false), []);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={link ? () => onButton(link) : undefined}
      role={link ? "button" : undefined}
      className={`${CARD_SHELL_CLASS} pointer-events-auto flex max-h-full w-max max-w-[440px] min-w-80 gap-2.5 py-2.5 pr-1.5 pl-3 select-none ${item.buttons.length > 0 ? "items-start" : "items-center"} ${link ? "cursor-pointer" : ""}`}
    >
      {item.imageUrl && !imageFailed ? (
        <img
          src={item.imageUrl}
          alt=""
          draggable={false}
          onError={() => setImageFailed(true)}
          className="size-8 flex-none rounded-md object-cover"
        />
      ) : (
        <span className="bg-brand h-8 w-1.5 flex-none rounded-sm" />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col self-stretch">
        <div className="min-h-0 overflow-y-auto [scrollbar-width:thin]">
          <p className="text-[13px] font-medium break-words text-white/90">
            {item.title}
          </p>
          {item.body && (
            <p className="text-[12px] break-words whitespace-pre-line text-white/50">
              {item.body}
            </p>
          )}
        </div>
        {item.buttons.length > 0 && (
          <div className="mt-2 flex flex-none flex-wrap items-center gap-1">
            {item.buttons.map((button, index) => (
              <button
                key={index}
                type="button"
                title={button.label}
                onClick={(event) => {
                  event.stopPropagation();
                  onButton(button);
                }}
                className={
                  button === link
                    ? `${BUTTON_CLASS} bg-brand text-brand-foreground hover:bg-brand/90`
                    : `${BUTTON_CLASS} text-white/65 hover:bg-white/10 hover:text-white`
                }
              >
                {button.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label={t("widget.notifications.dismiss")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="flex size-6 flex-none items-center justify-center rounded-md text-white/50 transition-colors hover:bg-white/10 hover:text-white"
      >
        <XIcon className="size-3.5" />
      </button>

      {item.timeoutMs > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-white/[0.07]">
          <span
            className="block h-full origin-left bg-white/35"
            style={{
              animationName: "widget-feed-timer",
              animationDuration: `${item.timeoutMs}ms`,
              animationDelay: `${timerDelayMs}ms`,
              animationTimingFunction: "linear",
              animationFillMode: "forwards",
              animationPlayState: hovered ? "paused" : "running",
            }}
          />
        </span>
      )}
    </div>
  );
};
