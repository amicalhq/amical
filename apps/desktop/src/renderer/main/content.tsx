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

// Root App component with routing
const App: React.FC = () => {
  // Listen for navigation events from main process (e.g., from widget)
  useEffect(() => {
    const handleNavigate = (route: string) => {
      router.navigate({ to: route });
    };

    window.electronAPI?.on?.("navigate", handleNavigate);

    return () => {
      window.electronAPI?.off?.("navigate", handleNavigate);
    };
  }, []);

  return <RouterProvider router={router} />;
};

export default App;
