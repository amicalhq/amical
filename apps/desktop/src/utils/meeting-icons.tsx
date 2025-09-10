import React from "react";
import { Calendar } from "lucide-react";

interface MeetingIconProps {
  className?: string;
}

// Helper function to determine meeting platform from URL
export function getMeetingPlatform(url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();

  // Remove www. prefix if present
  const cleanHostname = hostname.replace(/^www\./, "");

  switch (true) {
    case cleanHostname.includes("zoom.us"):
    case cleanHostname.includes("zoom.com"):
      return "zoom";

    case cleanHostname.includes("meet.google.com"):
    case cleanHostname.includes("meets.google.com"):
      return "google-meet";

    case cleanHostname.includes("teams.microsoft.com"):
    case cleanHostname.includes("teams.live.com"):
      return "microsoft-teams";

    case cleanHostname.includes("discord.com"):
    case cleanHostname.includes("discord.gg"):
      return "discord";

    case cleanHostname.includes("webex.com"):
      return "webex";

    case cleanHostname.includes("gotomeeting.com"):
      return "gotomeeting";

    case cleanHostname.includes("bluejeans.com"):
      return "bluejeans";

    case cleanHostname.includes("whereby.com"):
      return "whereby";

    default:
      return "default";
  }
}

// Component to render the appropriate meeting icon
export function getMeetingIcon(
  url: string,
  props: MeetingIconProps = {},
): React.ReactElement {
  const { className = "w-4 h-4" } = props;
  const platform = getMeetingPlatform(url);

  switch (platform) {
    case "zoom":
      return <img src="/assets/zoom.svg" alt="Zoom" className={className} />;

    case "google-meet":
      return (
        <img src="/assets/meet.svg" alt="Google Meet" className={className} />
      );

    case "discord":
      return (
        <img
          src="/assets/discord-icon.svg"
          alt="Discord"
          className={className}
        />
      );

    // Add more platforms as needed when you have their icons
    case "microsoft-teams":
    case "webex":
    case "gotomeeting":
    case "bluejeans":
    case "whereby":
    default:
      // Fallback to calendar icon for unknown platforms
      return <Calendar className={className} />;
  }
}

// Export the platforms for potential use elsewhere
export const SUPPORTED_PLATFORMS = {
  ZOOM: "zoom",
  GOOGLE_MEET: "google-meet",
  MICROSOFT_TEAMS: "microsoft-teams",
  DISCORD: "discord",
  WEBEX: "webex",
  GOTOMEETING: "gotomeeting",
  BLUEJEANS: "bluejeans",
  WHEREBY: "whereby",
  DEFAULT: "default",
} as const;
