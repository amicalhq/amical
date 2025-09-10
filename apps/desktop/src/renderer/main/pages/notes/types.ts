export type UpcomingEvent = {
  title: string;
  time: string;
  url: string;
  date?: string;
  calendarColor?: string;
};

export interface Note {
  id: number;
  title: string;
  icon?: string | null;
  updatedAt: Date;
  meetingEvent?: {
    title: string;
    calendarColor: string;
  };
}
