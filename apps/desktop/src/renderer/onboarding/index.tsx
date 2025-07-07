import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "@/styles/globals.css";

// Handle uncaught errors
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  window.onboardingAPI.log.error("Unhandled promise rejection:", event.reason);
});

window.addEventListener("error", (event) => {
  console.error("Uncaught error:", event.error);
  window.onboardingAPI.log.error("Uncaught error:", event.error);
});

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
