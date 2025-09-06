export type UpcomingEvent = {
  title: string;
  time: string;
  url: string;
  date?: string;
  calendarColor?: string;
};

export interface Note {
  id: string;
  name: string;
  icon?: string;
  lastUpdated: Date;
  meetingEvent?: {
    title: string;
    calendarColor: string;
  };
}
