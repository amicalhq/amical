import { IconMessageHeart } from "@tabler/icons-react";
import { SidebarIconButton } from "@/components/sidebar-icon-button";
import { usePostHog } from "@/renderer/lib/posthog";

export function FeedbackButton() {
  const { enabled, hasSurvey, showFeedbackSurvey } = usePostHog();

  if (!enabled || !hasSurvey) {
    return null;
  }

  return (
    <SidebarIconButton label="Feedback" onClick={showFeedbackSurvey}>
      <IconMessageHeart />
    </SidebarIconButton>
  );
}
