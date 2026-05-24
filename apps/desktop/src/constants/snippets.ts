export const TRIGGER_MAX_LENGTH = 60;
export const CONTENT_MAX_LENGTH = 4000;

// Sentinel used as the TRPCError.message on a duplicate-trigger conflict so the
// client can match it without depending on `error.data.code` (which is stripped
// by the electron-trpc-experimental bridge).
export const SNIPPET_ERROR_DUPLICATE_TRIGGER = "DUPLICATE_TRIGGER";
