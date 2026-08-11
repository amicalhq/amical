/**
 * Desktop session metadata — inert facts about the live session, published
 * with every lifecycle snapshot and never read by the reducer (§4.3: mode is
 * grammar state at the input edge, a composed projection at the surface, and
 * plain metadata here).
 */

export type RecordingMode = "ptt" | "hands-free";

export interface LifecycleSessionMeta {
  mode: RecordingMode;
  /** Draft review session: deliver into the pending draft, not a paste. */
  isDraft: boolean;
  /** Microphone reported by capture, for surface notifications. */
  microphone?: string;
}
