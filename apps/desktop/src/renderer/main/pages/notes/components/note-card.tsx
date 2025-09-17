"use client";

import { FileText, Calendar } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Note } from "../types";

interface RecentNoteCardProps {
  note: Note;
  onNoteClick: (noteId: number) => void;
}

export function NoteCard({ note, onNoteClick }: RecentNoteCardProps) {
  return (
    <div
      onClick={() => onNoteClick(note.id)}
      className={cn(
        "flex items-start gap-3 py-2 px-3 rounded-lg transition-colors group",
        "hover:bg-accent/50 hover:text-accent-foreground",
      )}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNoteClick(note.id);
        }
      }}
    >
      {/* Note Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {note.icon ? (
          <span className="text-lg">{note.icon}</span>
        ) : (
          <FileText className="w-5 h-5 text-muted-foreground" />
        )}
      </div>

      {/* Note Content */}
      <div className="flex-1 min-w-0">
        {/* Note Name */}
        <div className="font-medium text-foreground text-sm leading-tight">
          {note.title}
        </div>

        {/* Date and Meeting Info */}
        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
          <span>{formatDate(note.updatedAt)}</span>

          {note.meetingEvent && (
            <>
              <span className="w-1 h-1 bg-muted-foreground rounded-full"></span>
              <div className="flex items-center gap-1">
                <Calendar
                  className="w-3 h-3"
                  style={{ color: note.meetingEvent.calendarColor }}
                />
                <span className="">{note.meetingEvent.title}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
