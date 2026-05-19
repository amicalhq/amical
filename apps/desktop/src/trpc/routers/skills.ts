import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, procedure } from "../trpc";
import {
  createSkill,
  deleteSkill,
  getSkillById,
  listSkills,
  updateSkill,
} from "../../db/skills";

const ModeSchema = z.enum(["preset", "custom"]);
const PolishingSchema = z.enum(["none", "low", "normal", "high"]);
const ToneSchema = z.enum(["casual", "formal"]);

// Preset is intentionally a free-form string to mirror the wire format —
// the server defines presets and the desktop just passes the identifier.
// Minimum-length validation only.
const PresetSchema = z.string().min(1);

const BaseFields = z.object({
  name: z.string().min(1).max(80),
  mode: ModeSchema,
  preset: PresetSchema.nullable().optional(),
  prompt: z.string().min(1).nullable().optional(),
  polishing: PolishingSchema.nullable().optional(),
  tone: ToneSchema.nullable().optional(),
  // null means "reset to defaults" (the seeder/resolver merges JS
  // defaults at read time). Array means "user-customized list".
  includedApps: z.array(z.string()).nullable().optional(),
  includedSites: z.array(z.string()).nullable().optional(),
});

// Mode↔preset/prompt mutex — mirrors the DB CHECK constraint so we fail
// fast with a clear error at the API boundary instead of bubbling up a
// SQLite constraint violation.
const SkillBodySchema = BaseFields.refine(
  (data) => {
    if (data.mode === "preset") {
      return Boolean(data.preset) && (data.prompt ?? null) === null;
    }
    return Boolean(data.prompt) && (data.preset ?? null) === null;
  },
  {
    message:
      "preset is required when mode='preset' (and prompt must be unset); prompt is required when mode='custom' (and preset must be unset)",
  },
);

// For partial updates we accept any subset of fields, but if `mode` or
// any of preset/prompt are touched, the resulting row must still
// satisfy the mutex. The router enforces this after merging the patch
// onto the existing row, since zod alone can't validate against
// server-side state.
const SkillPatchSchema = BaseFields.partial();

export const skillsRouter = createRouter({
  list: procedure.query(async () => listSkills()),

  create: procedure.input(SkillBodySchema).mutation(async ({ input }) => {
    return createSkill({
      name: input.name,
      mode: input.mode,
      preset: input.preset ?? null,
      prompt: input.prompt ?? null,
      polishing: input.polishing ?? null,
      tone: input.tone ?? null,
      // User-created skills always own their list — start with empty
      // arrays (not null), since there are no app-side defaults to
      // inherit from for a user-created skill.
      includedApps: input.includedApps ?? [],
      includedSites: input.includedSites ?? [],
    });
  }),

  update: procedure
    .input(
      z.object({
        id: z.string(),
        data: SkillPatchSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await getSkillById(input.id);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Skill ${input.id} not found`,
        });
      }

      // Merge the patch onto the existing row, then validate the mutex.
      const merged = {
        mode: input.data.mode ?? existing.mode,
        preset: input.data.preset ?? existing.preset,
        prompt: input.data.prompt ?? existing.prompt,
      };
      const validMutex =
        merged.mode === "preset"
          ? Boolean(merged.preset) && (merged.prompt ?? null) === null
          : Boolean(merged.prompt) && (merged.preset ?? null) === null;
      if (!validMutex) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Resulting row violates mode↔preset/prompt mutex. When switching mode, also clear the other side and set the new one.",
        });
      }

      const updated = await updateSkill(input.id, input.data);
      if (!updated) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Update returned no row",
        });
      }
      return updated;
    }),

  delete: procedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const existing = await getSkillById(input.id);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Skill ${input.id} not found`,
        });
      }
      if (existing.isBuiltIn) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Built-in skills cannot be deleted",
        });
      }
      return deleteSkill(input.id);
    }),
});
