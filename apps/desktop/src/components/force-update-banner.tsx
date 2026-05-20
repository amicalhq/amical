import { Download, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { isMacOS } from "@/utils/platform";

const DOWNLOAD_URL = "https://amical.ai/download";

export function ForceUpdateBanner() {
  const { t } = useTranslation();

  if (!isMacOS()) return null;

  const handleDownload = () => {
    window.electronAPI?.openExternal(DOWNLOAD_URL);
  };

  return (
    <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex-1 min-w-0">
        <div className="font-medium">{t("forceUpdate.banner.title")}</div>
        <div className="text-muted-foreground text-xs">
          {t("forceUpdate.detail")}
        </div>
      </div>
      <Button size="sm" onClick={handleDownload} className="shrink-0">
        <Download className="size-3.5" />
        {t("forceUpdate.banner.cta")}
      </Button>
    </div>
  );
}
