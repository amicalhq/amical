import React, { useEffect } from "react";
import {
  RouterProvider,
  createRouter,
  createHashHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const hashHistory = createHashHistory();

// Create the router instance
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  history: hashHistory,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const LEGACY_ROUTE_MAP: Record<string, string> = {
  "/history": "/settings/history",
  "/settings/account": "/settings/ai-models?tab=speech",
  "/settings": "/settings/preferences",
};

function navigateToRoute(route: string) {
  const normalizedRoute = LEGACY_ROUTE_MAP[route] ?? route;
  const url = new URL(normalizedRoute, "http://localhost");
  const search = Object.fromEntries(url.searchParams.entries());
  router.navigate({ to: url.pathname, search });
}

// Root App component with routing
const App: React.FC = () => {
  // Listen for navigation events from main process (e.g., from widget)
  useEffect(() => {
    const handleNavigate = (route: string) => {
      navigateToRoute(route);
    };

    window.electronAPI?.on?.("navigate", handleNavigate);

    return () => {
      window.electronAPI?.off?.("navigate", handleNavigate);
    };
  }, []);

  return <RouterProvider router={router} />;
};

export default App;
