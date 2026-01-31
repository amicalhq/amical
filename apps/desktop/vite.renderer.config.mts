import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
// https://vitejs.dev/config
export default defineConfig(async () => {
  // @ts-ignore
  const { default: tailwindcss } = await import("@tailwindcss/vite");

  return {
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "./src/renderer/main/routes",
        generatedRouteTree: "./src/renderer/main/routeTree.gen.ts",
      }),
      react(),
      tailwindcss(),
    ],
    publicDir: "public",
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    optimizeDeps: {
      //! facing issues with main window at times
      //! and excluding next-themes and sonner isn't helping either
      //! 504 outdated optimize deps
      //! likely due to configs changing upon route tree regen of tanstack router
      force: true,
      exclude: ["better-sqlite3"],
    },
  };
});
