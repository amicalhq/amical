import type { FileRoutesByFullPath } from "@/renderer/main/routeTree.gen";

// The app's pages, as router paths. Pure data with no renderer/main-only deps
// (the router import is a type only), so the nav tree, the remote-config
// banners and the main process (checking links in untrusted content) all read
// the same list. A page the router no longer has fails to compile.
export const APP_PAGE_ROUTES = {
  notes: "/notes",
  history: "/history",
  preferences: "/settings/preferences",
  dictation: "/settings/dictation",
  shortcuts: "/settings/shortcuts",
  vocabulary: "/settings/vocabulary",
  snippets: "/settings/snippets",
  aiModels: "/settings/ai-models",
  labs: "/settings/labs",
  advanced: "/settings/advanced",
  about: "/settings/about",
} as const satisfies Record<string, keyof FileRoutesByFullPath>;

export type AppPageRoute =
  (typeof APP_PAGE_ROUTES)[keyof typeof APP_PAGE_ROUTES];

const ROUTES: ReadonlySet<string> = new Set(Object.values(APP_PAGE_ROUTES));

export function isAppPageRoute(route: string): route is AppPageRoute {
  return ROUTES.has(route);
}
