import type { GetAccessibilityContextResult } from "@amical/types";
import type { GrpcSkill } from "./grpc-dictation-client";
import { resolvePresetForBundleId } from "../../../shared/app-catalog";
import { listSkills } from "../../../db/skills";
import { logger } from "../../../main/logger";

/**
 * Server-known preset id that switches a cloud session into instruct
 * (generation) mode. The server treats `preset` as an open string and
 * generates content from the spoken instruction instead of formatting the
 * transcript. Mirrors the axis `INSTRUCT_PRESET_ID` (packages/prompts).
 */
export const INSTRUCT_PRESET_ID = "instruct";

/**
 * Pure mapper: a resolved preset (+ optional tone) → the cloud skill payload.
 * Tone rides in `args.tone` as a length-1 list; omitted entirely when null so
 * the server applies its per-preset default tone.
 */
export function buildPresetSkill(
  preset: string,
  tone: string | null,
): GrpcSkill {
  const skill: GrpcSkill = { preset };
  if (tone) skill.args = { tone: [tone] };
  return skill;
}

/**
 * preset → tone from the built-in skill rows. Tone is the one per-skill knob a
 * user can edit today; the app→preset mapping comes from the app catalog, not
 * from the skills table (the table's app lists aren't user-editable).
 */
async function builtInToneByPreset(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const skill of await listSkills()) {
      if (skill.isBuiltIn && skill.preset && skill.tone) {
        map.set(skill.preset, skill.tone);
      }
    }
  } catch (error) {
    // Tone is a refinement; if the skills table is unavailable, fall back to
    // the preset alone (the server applies its per-preset default tone) rather
    // than failing the transcription.
    logger.transcription.warn("Skill tone lookup failed; using default tone", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return map;
}

/**
 * Decide the resolved skills to send to the cloud for a session.
 *
 * - instruct mode → the instruct preset; all formatting/tone is ignored (the
 *   server runs generation, not cleanup).
 * - formatting off → empty (server returns the raw transcript).
 * - else → the foreground app's preset, resolved from the app catalog
 *   (`bundleIdentifier` is the macOS bundle id or the Windows process name),
 *   carrying the matching built-in skill's tone when one exists. An unmatched
 *   app resolves to the "default" preset — identical to the prior bridge.
 */
export async function resolveSessionSkills(opts: {
  isInstruct: boolean;
  enableFormatting: boolean;
  accessibilityContext: GetAccessibilityContextResult | null;
}): Promise<GrpcSkill[]> {
  if (opts.isInstruct) {
    return [{ preset: INSTRUCT_PRESET_ID }];
  }
  if (!opts.enableFormatting) {
    return [];
  }

  const identifier =
    opts.accessibilityContext?.context?.application?.bundleIdentifier ?? null;
  const preset = resolvePresetForBundleId(identifier);
  const tone = (await builtInToneByPreset()).get(preset) ?? null;
  return [buildPresetSkill(preset, tone)];
}
