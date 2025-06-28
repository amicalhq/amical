import { createTRPCReact } from "@trpc/react-query";
import { createTRPCProxyClient } from "@trpc/client";
import { ipcLink } from "electron-trpc-experimental/renderer";
import superjson from "superjson";
import type { AppRouter } from "./router";

// Create the tRPC React hooks
export const api = createTRPCReact<AppRouter>();

// Create the vanilla tRPC client (for use outside React components)
export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: [ipcLink({ transformer: superjson })],
});
