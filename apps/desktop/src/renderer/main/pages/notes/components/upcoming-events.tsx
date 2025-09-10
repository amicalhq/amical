import { Calendar, CalendarX, CalendarPlus } from "lucide-react";
import UpcomingEventCard from "./upcoming-event-card";
import { UpcomingEvent } from "../types";
import { Button } from "@/components/ui/button";

type CalendarState = "with-events" | "no-events" | "no-calendar";

// TOOD: add calendar connection and sync logic

export function UpcomingEvents() {
  // Switch this variable to test different states:
  // "with-events" - shows upcoming events
  // "no-events" - calendar connected but no events
  // "no-calendar" - no calendar connected
  const calendarState: CalendarState = "with-events";

  // TODO: replace mock data with actual data from backend
  // Mock events data
  const mockEvents: UpcomingEvent[] = [
    {
      title: "Product Review: Q3 Feature Planning",
      date: "Tomorrow",
      time: "2:00 – 3:00 PM",
      url: "https://zoom.us/j/123456789",
    },
    {
      title: "1:1 with Sarah - Engineering Sync",
      date: "Sep 8th",
      time: "10:00 – 10:30 AM",
      url: "https://meet.google.com/abc-defg-hij",
    },
  ];

  // Determine events based on state
  const upcomingEvents = calendarState === "with-events" ? mockEvents : [];

  const handleTakeNotes = (event: UpcomingEvent) => {
    // Handle taking notes for the event
    console.log("Taking notes for:", event.title);
    // TODO: navigate to a notes editor, open a modal, etc.
    // You can implement your note-taking logic here
    // For example: navigate to a notes editor, open a modal, etc.
  };

  const handleConnectCalendar = () => {
    // Handle connecting calendar
    console.log("Connecting calendar...");
    // TODO: implement your calendar connection logic here
    // You can implement your calendar connection logic here
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Calendar className="w-4 h-4" />
        <h2 className="text-sm font-medium">Upcoming events</h2>
      </div>

      {calendarState === "with-events" ? (
        <div className="bg-accent/40 rounded-xl overflow-clip">
          {upcomingEvents.map((event, index) => (
            <div key={index}>
              <UpcomingEventCard event={event} onTakeNotes={handleTakeNotes} />
            </div>
          ))}
        </div>
      ) : calendarState === "no-events" ? (
        <div className="border border-dashed rounded-lg p-6 text-center">
          <CalendarX className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No upcoming events</p>
        </div>
      ) : (
        <div className="border border-dashed rounded-lg p-6 text-center space-y-4">
          <CalendarPlus className="w-8 h-8 text-muted-foreground mx-auto" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Connect your calendar
              <br />
              Connect your calendar to get started
            </p>
            <Button
              onClick={handleConnectCalendar}
              className="mt-2"
              size={"sm"}
              variant={"outline"}
            >
              <CalendarPlus className="w-4 h-4" />
              Connect calendar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
