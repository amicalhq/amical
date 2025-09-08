import React from "react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// Create the router instance
const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Root App component with routing
const App: React.FC = () => {
  return <RouterProvider router={router} />;
};

export default App;
