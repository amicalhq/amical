"use client"

import { FileText, Calendar, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Note {
  id: string
  name: string
  icon?: string
  lastUpdated: Date
  meetingEvent?: {
    title: string
    calendarColor: string
  }
}

interface RecentNoteCardProps {
  note: Note
  onNoteClick: (noteId: string) => void
}

function formatDate(date: Date): string {
  const now = new Date()
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffInDays === 0) return "Today"
  if (diffInDays === 1) return "Yesterday"

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  })
}

function truncateText(text: string, maxLength = 50): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}

export function RecentNoteCard({ note, onNoteClick }: RecentNoteCardProps) {
  return (
    <div
      onClick={() => onNoteClick(note.id)}
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg transition-colors group",
        "hover:bg-accent/50 hover:text-accent-foreground",
        "border-border/80 border"
      )}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onNoteClick(note.id)
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
        <div className="font-medium text-foreground text-sm leading-tight">{truncateText(note.name)}</div>

        {/* Date and Meeting Info */}
        <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
          <span>{formatDate(note.lastUpdated)}</span>

          {note.meetingEvent && (
            <>
              <span className="w-1 h-1 bg-muted-foreground rounded-full"></span>
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" style={{ color: note.meetingEvent.calendarColor }} />
                <span className="">{note.meetingEvent.title}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
