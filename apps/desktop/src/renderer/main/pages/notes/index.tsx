import { NotesList } from "./components/notes-list";

export default function Notes() {
  return (
    <div className="space-y-6 p-2">
      {/* Upcoming events section */}
      {/* <UpcomingEvents /> */}

      {/* Recent notes section */}
      <NotesList />
    </div>
  );
}
