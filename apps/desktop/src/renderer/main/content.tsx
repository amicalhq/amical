import React, { useEffect } from "react";
import {
  RouterProvider,
  createRouter,
  createHashHistory,
  defaultParseSearch,
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

// Root App component with routing
const App: React.FC = () => {
  // Listen for navigation events from main process (e.g., from widget)
  useEffect(() => {
    const handleNavigate = (route: string) => {
      // The main process sends one path string that may include search params
      // (e.g. "/settings/about?focusUpdate=true"). router.navigate takes search
      // as a separate object and won't parse a query out of `to`, so split the
      // string and parse the search the way the router does for URLs.
      const queryIndex = route.indexOf("?");
      if (queryIndex === -1) {
        router.navigate({ to: route });
        return;
      }
      router.navigate({
        to: route.slice(0, queryIndex),
        search: defaultParseSearch(route.slice(queryIndex)),
      });
    };

    window.electronAPI?.on?.("navigate", handleNavigate);

    return () => {
      window.electronAPI?.off?.("navigate", handleNavigate);
    };
  }, []);

  return <RouterProvider router={router} />;
};

export default App;
