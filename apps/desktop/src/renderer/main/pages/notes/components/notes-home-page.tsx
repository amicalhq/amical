import { UpcomingEvents } from "./upcoming-events";
import { MyNotes } from "./my-notes";

type NotesHomePageProps = {
  onNoteClick: (noteId: string) => void;
};

export function NotesHomePage({ onNoteClick }: NotesHomePageProps) {
  return (
    <div className="space-y-6 p-2">
      {/* Upcoming events section */}
      <UpcomingEvents />

      {/* Recent notes section */}
      <MyNotes onNoteClick={onNoteClick} />
    </div>
  );
}
