import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, procedure } from "../trpc";
import {
  createSnippet,
  deleteSnippet,
  findSnippetByTriggerCaseInsensitive,
  getSnippets,
  updateSnippet,
} from "../../db/snippets";
import {
  CONTENT_MAX_LENGTH,
  SNIPPET_ERROR_DUPLICATE_TRIGGER,
  TRIGGER_MAX_LENGTH,
} from "../../constants/snippets";

const GetSnippetsSchema = z.object({
  limit: z.number().optional(),
  search: z.string().optional(),
});

const CreateSnippetSchema = z.object({
  trigger: z.string().min(1).max(TRIGGER_MAX_LENGTH),
  content: z.string().min(1).max(CONTENT_MAX_LENGTH),
});

const UpdateSnippetSchema = z.object({
  trigger: z.string().min(1).max(TRIGGER_MAX_LENGTH).optional(),
  content: z.string().min(1).max(CONTENT_MAX_LENGTH).optional(),
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

  updateSnippet: procedure
    .input(z.object({ id: z.number(), data: UpdateSnippetSchema }))
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

  deleteSnippet: procedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return await deleteSnippet(input.id);
    }),
});
