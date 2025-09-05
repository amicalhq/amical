import React from "react";
import { Calendar, NotebookText } from "lucide-react";
import UpcomingEventCard from "./components/upcoming-event-card";
import { RecentNoteCard, type Note } from "./components/recent-note-card";

// Import the type from the component
type UpcomingEvent = {
  title: string;
  time: string;
  url: string;
  date?: string;
  calendarColor?: string;
};

export function NotesPage() {
  // Example events data - replace with real data from your state/API
  const upcomingEvents: UpcomingEvent[] = [
    {
      title: "LeadrPro Demo: Hatica Inc <> Skuad",
      date: "Today September 6th",
      time: "12:30 – 1 PM",
      url: "https://meetings.leadrpro.com/demo?refid=cyol83iyozu",
      calendarColor: "#A855F7"
    },
    {
      title: "Product Review: Q3 Feature Planning",
      date: "Tomorrow September 7th",
      time: "2:00 – 3:00 PM",
      url: "https://zoom.us/j/123456789",
      calendarColor: "#10B981"
    },
    {
      title: "1:1 with Sarah - Engineering Sync",
      date: "Friday September 8th",
      time: "10:00 – 10:30 AM",
      url: "https://meet.google.com/abc-defg-hij",
      calendarColor: "#F59E0B"
    }
  ];

  // Example recent notes data - replace with real data from your state/API
  const recentNotes: Note[] = [
    {
      id: "1",
      name: "LeadrPro Demo Meeting Notes",
      icon: "📝",
      lastUpdated: new Date(),
      meetingEvent: {
        title: "LeadrPro Demo: Hatica Inc <> Skuad",
        calendarColor: "#A855F7"
      }
    },
    {
      id: "2",
      name: "Product Strategy Discussion",
      icon: "💡",
      lastUpdated: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      meetingEvent: {
        title: "Product Review: Q3 Feature Planning",
        calendarColor: "#10B981"
      }
    },
    {
      id: "3",
      name: "Engineering Architecture Review",
      lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    },
    {
      id: "4",
      name: "Weekly Team Standup Notes",
      icon: "👥",
      lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      meetingEvent: {
        title: "Weekly Team Standup",
        calendarColor: "#EF4444"
      }
    },
    {
      id: "5",
      name: "Client Feedback Compilation",
      icon: "📊",
      lastUpdated: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    }
  ];

  const handleTakeNotes = (event: UpcomingEvent) => {
    // Handle taking notes for the event
    console.log("Taking notes for:", event.title);
    // You can implement your note-taking logic here
    // For example: navigate to a notes editor, open a modal, etc.
  };

  const handleNoteClick = (noteId: string) => {
    // Handle note click - open note editor, navigate to note details, etc.
    console.log("Opening note:", noteId);
    // You can implement your note opening logic here
  };

  return (
    <div className="space-y-6 p-2">
      {/* Upcoming events section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <h2 className="text-sm font-medium">Upcoming events</h2>
        </div>
        
        <div className="space-y-3">
          {upcomingEvents.map((event, index) => (
            <UpcomingEventCard 
              key={index} 
              event={event} 
              onTakeNotes={handleTakeNotes} 
            />
          ))}
        </div>
      </div>

      {/* Recent notes section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <NotebookText className="w-4 h-4" />
          <h2 className="text-sm font-medium">Recent Notes</h2>
        </div>
        
        <div className="space-y-2">
          {recentNotes.map((note) => (
            <RecentNoteCard 
              key={note.id} 
              note={note} 
              onNoteClick={handleNoteClick} 
            />
          ))}
        </div>
      </div>


    </div>
  );
}