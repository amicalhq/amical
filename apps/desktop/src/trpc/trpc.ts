import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create({
  isServer: true,
  transformer: superjson,
});

export const procedure = t.procedure;
export const createRouter = t.router;
