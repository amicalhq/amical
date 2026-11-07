import { defineConfig } from "vite";
import { resolve } from "path";
import { posthogSourceMapPlugins } from "./vite.posthog";

// https://vitejs.dev/config
export default defineConfig(async () => {
  const { default: tailwindcss } = await import("@tailwindcss/vite");

  return {
    plugins: [tailwindcss(), ...posthogSourceMapPlugins()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    optimizeDeps: {
      exclude: ["better-sqlite3"],
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "notes-widget.html"),
        },
      },
    },
  };
});
