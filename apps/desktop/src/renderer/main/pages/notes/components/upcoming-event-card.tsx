import { NotebookPen } from "lucide-react";
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
    <div className="bg-transparent border-none group hover:bg-accent/60 transition-colors relative py-3 px-4">
      <div className="flex items-start gap-4">
        {/* Leading icon */}
        <div className="flex-shrink-0 mt-0.5">
          {getMeetingIcon(event.url, {
            className: "w-5 h-5 text-muted-foreground",
          })}
        </div>

        <div className="flex-1 space-y-2">
          {/* Event title */}
          <h3 className="text-foreground text-sm font-medium leading-tight line-clamp-1">
            {event.title}
          </h3>

          {/* Time and meeting url */}
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span className="whitespace-nowrap">
              {event.date} {event.time}
            </span>
            |{" "}
            {
              <a
                onClick={handleLinkClick}
                className="text-muted-foreground text-xs line-clamp-1 hover:text-foreground cursor-pointer transition-colors"
              >
                {event.url}
              </a>
            }
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
    </div>
  );
};

export default UpcomingEventCard;
