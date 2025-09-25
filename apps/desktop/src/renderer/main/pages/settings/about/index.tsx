import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/trpc/react";

const CHANGELOG_URL = "https://github.com/amicalhq/amical/releases";
const GITHUB_URL = "https://github.com/amicalhq/amical";
const DISCORD_URL = "https://amical.ai/community";
const CONTACT_EMAIL = "contact@amical.ai";

export default function AboutSettingsPage() {
  const [checking, setChecking] = useState(false);
  const { data: version } = api.settings.getAppVersion.useQuery();

  function handleCheckUpdates() {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      toast.success("Version is up to date");
    }, 2000);
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      {/* Header Section */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">About</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Version information, resources, and support links
        </p>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">Current Version</div>
              <Badge variant="secondary" className="mt-1">
                v{version || "..."}
              </Badge>
            </div>
            {/* <Button
              variant="outline"
              className="mt-4 md:mt-0 flex items-center gap-2"
              onClick={handleCheckUpdates}
              disabled={checking}
            >
              <RefreshCw
                className={"w-4 h-4 " + (checking ? "animate-spin" : "")}
              />
              {checking ? "Checking..." : "Check for Updates"}
            </Button> */}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-foreground">
                Resources
              </div>
              <p className="text-xs text-muted-foreground">
                Get help, report issues, and stay updated with the latest
                changes
              </p>
            </div>
            <div className="divide-y">
              <ExternalLink href={CHANGELOG_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      <BookOpen className="w-5 h-5 text-muted-foreground" />
                      Change Log
                    </div>
                    <div className="text-muted-foreground text-xs">
                      View release notes and updates
                    </div>
                  </div>
                </div>
              </ExternalLink>
              <ExternalLink href={GITHUB_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      {/* GitHub icon as image */}
                      <img
                        src="icons/integrations/github.svg"
                        alt="GitHub"
                        className="w-5 h-5 inline-block align-middle"
                      />
                      GitHub Repository
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Source code and issue tracking
                    </div>
                  </div>
                </div>
              </ExternalLink>
              <ExternalLink href={DISCORD_URL}>
                <div className="flex items-center justify-between py-4 group cursor-pointer">
                  <div>
                    <div className="flex items-center gap-2 font-semibold text-base group-hover:underline">
                      {/* Discord icon as image */}
                      <img
                        src="icons/integrations/discord.svg"
                        alt="Discord"
                        className="w-5 h-5 inline-block align-middle"
                      />
                      Discord Community
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Join our community for support and discussions
                    </div>
                  </div>
                </div>
              </ExternalLink>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-lg font-semibold text-foreground">
                Contact
              </div>
              <p className="text-xs text-muted-foreground">
                Get in touch with our team for support and inquiries
              </p>
            </div>
            <ExternalLink href={`mailto:${CONTACT_EMAIL}`}>
              <div className="flex items-center justify-between group cursor-pointer">
                <div>
                  <div className="font-semibold text-base group-hover:underline">
                    {CONTACT_EMAIL}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    Send us an email
                  </div>
                </div>
              </div>
            </ExternalLink>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

const ExternalLink = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => {
  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (window.electronAPI?.openExternal) {
      await window.electronAPI.openExternal(href);
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick(e as any);
        }
      }}
      style={{ cursor: "pointer" }}
    >
      {children}
    </a>
  );
};
