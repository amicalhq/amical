// Stub for "@/trpc/react" used by renderer tests. The real module creates a tRPC
// React client that pulls in @trpc/react-query and electron IPC, which the
// jsdom/web test transform can't resolve. Only the surface the hooks touch is
// implemented here; expand as renderer tests need more of the api.
const utils = {
  client: {
    remoteConfig: {
      get: {
        query: async () => ({ flags: { "desktop-stereo-mic-downmix": true } }),
      },
    },
  },
};

export const api = {
  useUtils: () => utils,
  settings: {
    getSettings: {
      useQuery: (): { data: undefined } => ({ data: undefined }),
    },
  },
};
