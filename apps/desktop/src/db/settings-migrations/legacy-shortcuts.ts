import type { AppSettingsData } from "../schema";

export type ShortcutSettingsBeforeV15 = {
  pushToTalk?: number[];
  toggleRecording?: number[];
  pasteLastTranscript?: number[];
  newNote?: number[];
  draftMode?: number[];
};

export type AppSettingsDataBeforeV15 = Omit<AppSettingsData, "shortcuts"> & {
  shortcuts?: ShortcutSettingsBeforeV15;
};

export type ShortcutSettingsBeforeV6 = {
  pushToTalk?: Array<string | number>;
  toggleRecording?: Array<string | number>;
  pasteLastTranscript?: Array<string | number>;
};

export type AppSettingsDataBeforeV6 = Omit<AppSettingsData, "shortcuts"> & {
  shortcuts?: ShortcutSettingsBeforeV6;
};
