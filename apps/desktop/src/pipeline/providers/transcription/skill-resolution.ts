import type { GrpcSkill } from "./grpc-dictation-client";

/**
 * Server-known preset id that switches a cloud session into instruct
 * (generation) mode. The server treats `preset` as an open string and
 * generates content from the spoken instruction instead of formatting the
 * transcript. Mirrors the axis `INSTRUCT_PRESET_ID` (packages/prompts).
 */
export const INSTRUCT_PRESET_ID = "instruct";

/**
 * Decide the resolved skills to send to the cloud for a session.
 *
 * - instruct mode → the instruct preset; all other formatting/tone is ignored
 *   (the server runs generation, not cleanup).
 * - formatting on → the temporary "default" bridge preset (until per-app skill
 *   resolution is wired into the pipeline).
 * - neither → empty (server returns the raw transcript).
 */
export function resolveSessionSkills(opts: {
  isInstruct: boolean;
  enableFormatting: boolean;
}): GrpcSkill[] {
  if (opts.isInstruct) {
    return [{ preset: INSTRUCT_PRESET_ID }];
  }
  if (opts.enableFormatting) {
    return [{ preset: "default", args: { tone: ["casual"] } }];
  }
  return [];
}
