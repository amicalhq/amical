import { IconRefresh } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { api } from "@/trpc/react";

export function DevFeatureFlagsRefresh() {
  const utils = api.useUtils();

  const refreshFeatureFlagsMutation = api.featureFlags.refresh.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.featureFlags.getAll.invalidate(),
        utils.featureFlags.getFlag.invalidate(),
      ]);
      toast.success("Feature flags refreshed");
    },
    onError: (error) => {
      toast.error("Failed to refresh feature flags", {
        description: error.message,
      });
    },
  });

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        onClick={() => refreshFeatureFlagsMutation.mutate()}
        disabled={refreshFeatureFlagsMutation.isPending}
      >
        {refreshFeatureFlagsMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <IconRefresh />
        )}
        <span>Refresh Flags</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
