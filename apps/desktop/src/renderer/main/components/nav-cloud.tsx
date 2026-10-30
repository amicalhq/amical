import { IconCreditCard, IconUserPlus, type Icon } from "@tabler/icons-react";
import { toast } from "sonner";

import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { BILLING_RETURN_PATH } from "@/constants/web-app";
import { api } from "@/trpc/react";

type CloudItem = { title: string; icon: Icon; returnPath: string };

const CLOUD_ITEMS: CloudItem[] = [
  {
    title: "Invite Team",
    icon: IconUserPlus,
    returnPath: "/organization/members",
  },
  {
    title: "Usage & Billing",
    icon: IconCreditCard,
    returnPath: BILLING_RETURN_PATH,
  },
];

// Returns a fragment so callers can slot these items into an existing
// SidebarMenu — a separate SidebarGroup would add an 8px boundary gap.
export function NavCloud() {
  const authStatusQuery = api.auth.getAuthStatus.useQuery();
  const openWebSessionMutation = api.auth.openWebSession.useMutation({
    onError: (error) => {
      toast.error("Couldn't open in browser", {
        description: error.message,
      });
    },
  });

  if (!authStatusQuery.data?.isAuthenticated) {
    return null;
  }

  return (
    <>
      {CLOUD_ITEMS.map((item) => (
        <SidebarMenuItem key={item.returnPath}>
          <SidebarMenuButton
            // Only the row being opened waits; the other stays usable.
            disabled={
              openWebSessionMutation.isPending &&
              openWebSessionMutation.variables?.returnPath === item.returnPath
            }
            onClick={() =>
              openWebSessionMutation.mutate({ returnPath: item.returnPath })
            }
          >
            <item.icon />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </>
  );
}
