import { defineConfig } from "vite";
import { resolve } from "path";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
// https://vitejs.dev/config
export default defineConfig(async () => {
  // @ts-ignore
  const { default: tailwindcss } = await import("@tailwindcss/vite");

  return {
    plugins: [
      TanStackRouterVite({
        routesDirectory: "./src/renderer/main/routes",
        generatedRouteTree: "./src/renderer/main/routeTree.gen.ts",
      }),
      tailwindcss(),
    ],
    publicDir: "public",
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    optimizeDeps: {
      exclude: ["better-sqlite3"],
    },
  };
});
