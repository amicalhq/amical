import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, trpcClient } from "@/trpc/react";
import { MainLayout } from "./components/MainLayout";
import SettingsApp from "../settings/content";

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

// Root App component with routing
const App: React.FC = () => {
  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/*" element={<SettingsApp />} />
            {/* <Route path="/*" element={<MainLayout />} /> */}
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </api.Provider>
  );
};

export default App;
