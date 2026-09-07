export type UpcomingEvent = {
  title: string;
  time: string;
  url: string;
  date?: string;
  calendarColor?: string;
};

export interface Note {
  id: string;
  title: string;
  syncError?: string | null;
  icon?: string | null;
  updatedAt: Date;
  meetingEvent?: {
    title: string;
    calendarColor: string;
  };
}
