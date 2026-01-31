import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
// https://vitejs.dev/config
export default defineConfig(async () => {
  // @ts-ignore
  const { default: tailwindcss } = await import("@tailwindcss/vite");

  return {
    plugins: [react(), tailwindcss()],
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
          main: resolve(__dirname, "widget.html"),
        },
      },
    },
  };
});
