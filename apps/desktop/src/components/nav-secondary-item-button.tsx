import { type Icon } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { SidebarCtaPalette, SidebarCtaStyle } from "@/utils/feature-flags";
import { isInternalUrl } from "@/utils/url";

export type NavSecondaryItemStyle = {
  palette?: SidebarCtaPalette;
  style?: SidebarCtaStyle;
  emoji?: string;
};

export type NavSecondaryItem = {
  id: string;
  title: string;
  url: string;
  icon: Icon;
  ctaStyle?: NavSecondaryItemStyle;
};

type CtaClasses = {
  buttonClassName?: string;
  labelClassName?: string;
  borderWrapperClassName?: string;
  isBorderStyle: boolean;
};

const CTA_EMOJI_CLASS = "flex size-4 items-center justify-center shrink-0";

const CTA_STYLE_CLASS_MAP: Record<
  SidebarCtaPalette,
  {
    solidButtonClassName: string;
    textLabelClassName: string;
    shimmerLabelClassName: string;
    borderWrapperClassName: string;
  }
> = {
  purple: {
    solidButtonClassName:
      "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 hover:text-white",
    textLabelClassName:
      "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent",
    shimmerLabelClassName:
      "animate-shimmer bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 from-30% via-50% to-70% bg-clip-text text-transparent",
    borderWrapperClassName:
      "relative w-full rounded-md p-[1.5px] bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500",
  },
  green: {
    solidButtonClassName:
      "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400 text-white hover:from-emerald-600 hover:via-teal-600 hover:to-cyan-500 hover:text-white",
    textLabelClassName:
      "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400 bg-clip-text text-transparent",
    shimmerLabelClassName:
      "animate-shimmer bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400 from-30% via-50% to-70% bg-clip-text text-transparent",
    borderWrapperClassName:
      "relative w-full rounded-md p-[1.5px] bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400",
  },
};

function getCtaClasses(ctaStyle?: NavSecondaryItemStyle): CtaClasses {
  if (!ctaStyle) {
    return { isBorderStyle: false };
  }

  const palette = ctaStyle.palette ?? "purple";
  const style = ctaStyle.style ?? "solid";
  const paletteClasses = CTA_STYLE_CLASS_MAP[palette];

  if (style === "solid") {
    return {
      buttonClassName: paletteClasses.solidButtonClassName,
      isBorderStyle: false,
    };
  }

  if (style === "text") {
    return {
      labelClassName: paletteClasses.textLabelClassName,
      isBorderStyle: false,
    };
  }

  if (style === "shimmer") {
    return {
      labelClassName: paletteClasses.shimmerLabelClassName,
      isBorderStyle: false,
    };
  }

  return {
    buttonClassName:
      "h-auto min-h-8 overflow-visible p-0 hover:bg-transparent active:bg-transparent group-data-[collapsible=icon]:p-0!",
    borderWrapperClassName: paletteClasses.borderWrapperClassName,
    isBorderStyle: true,
  };
}

function renderItemContent(item: NavSecondaryItem, ctaClasses: CtaClasses) {
  const leading = item.ctaStyle?.emoji ? (
    <span className={CTA_EMOJI_CLASS}>{item.ctaStyle.emoji}</span>
  ) : (
    <item.icon />
  );

  const label = <span className={ctaClasses.labelClassName}>{item.title}</span>;

  if (!ctaClasses.isBorderStyle || !ctaClasses.borderWrapperClassName) {
    return (
      <>
        {leading}
        {label}
      </>
    );
  }

  return (
    <div className={ctaClasses.borderWrapperClassName}>
      <div className="flex w-full items-center gap-2 rounded-[calc(var(--radius-md)-1.5px)] bg-sidebar p-2 hover:bg-sidebar-accent">
        {leading}
        {label}
      </div>
    </div>
  );
}

export function NavSecondaryItemButton({
  item,
  isActive,
}: {
  item: NavSecondaryItem;
  isActive: boolean;
}) {
  const ctaClasses = getCtaClasses(item.ctaStyle);
  const buttonClassName = cn(ctaClasses.buttonClassName);
  const content = renderItemContent(item, ctaClasses);

  if (!isInternalUrl(item.url)) {
    return (
      <SidebarMenuButton
        className={buttonClassName}
        onClick={async () => {
          await window.electronAPI.openExternal(item.url);
        }}
      >
        {content}
      </SidebarMenuButton>
    );
  }

  return (
    <SidebarMenuButton
      asChild
      className={buttonClassName}
      tooltip={item.title}
      isActive={isActive}
    >
      <Link
        to={item.url}
        aria-label={item.title}
        activeProps={{
          className: "active",
        }}
      >
        {content}
      </Link>
    </SidebarMenuButton>
  );
}
