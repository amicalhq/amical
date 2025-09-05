import React from "react";
import { NotebookPen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getMeetingIcon } from "@/utils/meeting-icons";

interface UpcomingEvent {
  title: string;
  time: string;
  url: string;
  date?: string;
  calendarColor?: string;
}

interface UpcomingEventCardProps {
  event: UpcomingEvent;
  onTakeNotes?: (event: UpcomingEvent) => void;
}

const UpcomingEventCard = ({ event, onTakeNotes }: UpcomingEventCardProps) => {
  const handleLinkClick = () => {
    if (event.url) {
      // Open external link - adjust this based on your Electron setup
      window.electronAPI.openExternal(event.url);
    }
  };

  const handleTakeNotes = () => {
    onTakeNotes?.(event);
  };

  return (
    <Card className="bg-accent/40 group hover:bg-accent/60 transition-colors relative py-4">
      <CardContent className="">
        {/* Event date */}
        <div className="text-xs text-red-400 mb-3">{event.date}</div>

        <div className="flex items-start gap-4">
          {/* Colored accent bar */}
          <div
            className="w-1 h-12 bg-red-500 rounded-full flex-shrink-0"
            style={{ backgroundColor: event.calendarColor }}
          />

          <div className="flex-1 space-y-2">
            {/* Event title */}
            <h3 className="text-foreground text-sm font-medium leading-tight line-clamp-1">
              {event.title}
            </h3>

            {/* Time with meeting platform icon and meeting url */}
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              {getMeetingIcon(event.url, {
                className: "w-4 h-4 flex-shrink-0",
              })}
              <span className="whitespace-nowrap">{event.time}</span>
              {event.url && (
                <a
                  onClick={handleLinkClick}
                  className="text-muted-foreground text-xs line-clamp-1 hover:text-foreground cursor-pointer transition-colors"
                >
                  {event.url}
                </a>
              )}
            </div>
          </div>

          {/* take notes button - visible only on hover */}
          <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex-shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleTakeNotes}
                  className="h-8 w-8 p-0"
                >
                  <NotebookPen className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Take notes</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default UpcomingEventCard;
