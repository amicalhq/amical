// Stub for "@/trpc/react" used by renderer tests. The real module creates a tRPC
// React client that pulls in @trpc/react-query and electron IPC, which the
// jsdom/web test transform can't resolve. Only the surface the hooks touch is
// implemented here; expand as renderer tests need more of the api.
export const api = {
  settings: {
    getSettings: {
      useQuery: (): { data: undefined } => ({ data: undefined }),
    },
  },
};
