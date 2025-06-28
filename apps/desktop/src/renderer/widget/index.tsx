import React from "react";
import { createRoot } from "react-dom/client";
import { WidgetPage } from "./pages/widget";
import "@/styles/globals.css";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<WidgetPage />);
} else {
  console.error(
    "FloatingButton: Root element not found in floating-button.html",
  );
}
