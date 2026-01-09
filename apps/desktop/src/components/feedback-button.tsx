import { IconMessageHeart } from "@tabler/icons-react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { usePostHog } from "@/renderer/main/lib/posthog";

export function FeedbackButton() {
  const { enabled, hasSurvey, showFeedbackSurvey } = usePostHog();

  if (!enabled || !hasSurvey) {
    return null;
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton onClick={showFeedbackSurvey}>
        <IconMessageHeart />
        <span>Feedback</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
