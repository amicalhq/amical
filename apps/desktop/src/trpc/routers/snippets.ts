import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { SettingsSyncUuidSchema } from "@amical/types";
import { createRouter, procedure } from "../trpc";
import {
  createSnippet,
  createOrganizationSnippet,
  deleteSnippet,
  deleteOrganizationSnippet,
  findSnippetByTriggerCaseInsensitive,
  getSnippets,
  updateSnippet,
  updateOrganizationSnippet,
} from "../../db/snippets";
import { getActiveOrganizationAccess } from "../../db/sync";
import { SNIPPET_ERROR_DUPLICATE_TRIGGER } from "../../constants/snippets";
import {
  axisSyncRequiredTextSchema,
  trimmedSyncKeySchema,
} from "../../db/sync-payload";

const GetSnippetsSchema = z.object({
  limit: z.number().optional(),
  search: z.string().optional(),
  scope: z.enum(["all", "user", "org"]).optional(),
});

const CreateSnippetSchema = z.object({
  trigger: trimmedSyncKeySchema,
  content: axisSyncRequiredTextSchema,
});

const UpdateSnippetSchema = z.object({
  trigger: trimmedSyncKeySchema.optional(),
  content: axisSyncRequiredTextSchema.optional(),
});

function isDuplicateTriggerError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return (
    message.includes("UNIQUE constraint failed") &&
    message.includes("snippets.trigger")
  );
}

export const snippetsRouter = createRouter({
  getSnippets: procedure.input(GetSnippetsSchema).query(async ({ input }) => {
    return await getSnippets(input);
  }),

  getScopeAccess: procedure.query(async () => getActiveOrganizationAccess()),

  createSnippet: procedure
    .input(CreateSnippetSchema)
    .mutation(async ({ input }) => {
      // Look up an existing snippet that matches the new trigger case-insensitively.
      // A case-sensitive identical match will be rejected by the UNIQUE constraint
      // below; this check only surfaces near-duplicates like "Sig" vs "sig".
      const similarExisting = await findSnippetByTriggerCaseInsensitive(
        input.trigger,
      );

      let snippet;
      try {
        snippet = await createSnippet(input);
      } catch (err) {
        if (isDuplicateTriggerError(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: SNIPPET_ERROR_DUPLICATE_TRIGGER,
          });
        }
        throw err;
      }

      const similarTrigger =
        similarExisting && similarExisting.trigger !== input.trigger
          ? similarExisting.trigger
          : null;
      return { snippet, similarTrigger };
    }),

  createOrganizationSnippet: procedure
    .input(CreateSnippetSchema)
    .mutation(async ({ input }) => {
      const similarExisting = await findSnippetByTriggerCaseInsensitive(
        input.trigger,
        "org",
      );
      let snippet;
      try {
        snippet = await createOrganizationSnippet(input);
      } catch (err) {
        if (isDuplicateTriggerError(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: SNIPPET_ERROR_DUPLICATE_TRIGGER,
          });
        }
        throw err;
      }
      return {
        snippet,
        similarTrigger:
          similarExisting && similarExisting.trigger !== input.trigger
            ? similarExisting.trigger
            : null,
      };
    }),

  updateSnippet: procedure
    .input(z.object({ id: SettingsSyncUuidSchema, data: UpdateSnippetSchema }))
    .mutation(async ({ input }) => {
      try {
        return await updateSnippet(input.id, input.data);
      } catch (err) {
        if (isDuplicateTriggerError(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: SNIPPET_ERROR_DUPLICATE_TRIGGER,
          });
        }
        throw err;
      }
    }),

  updateOrganizationSnippet: procedure
    .input(z.object({ id: SettingsSyncUuidSchema, data: UpdateSnippetSchema }))
    .mutation(async ({ input }) => {
      try {
        return await updateOrganizationSnippet(input.id, input.data);
      } catch (err) {
        if (isDuplicateTriggerError(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: SNIPPET_ERROR_DUPLICATE_TRIGGER,
          });
        }
        throw err;
      }
    }),

  deleteSnippet: procedure
    .input(z.object({ id: SettingsSyncUuidSchema }))
    .mutation(async ({ input }) => {
      return await deleteSnippet(input.id);
    }),

  deleteOrganizationSnippet: procedure
    .input(z.object({ id: SettingsSyncUuidSchema }))
    .mutation(async ({ input }) => {
      return await deleteOrganizationSnippet(input.id);
    }),
});
