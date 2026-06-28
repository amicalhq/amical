import { defineConfig } from "vite";
import { resolve } from "path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
// https://vitejs.dev/config
export default defineConfig(async () => {
  const { default: tailwindcss } = await import("@tailwindcss/vite");

  return {
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
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
      //! facing issues with main window at times
      //! and excluding next-themes and sonner isn't helping either
      //! 504 outdated optimize deps
      //! likely due to configs changing upon route tree regen of tanstack router
      force: true,
      // The remote-config surfaces use eager `import { icons }` from lucide,
      // which pulls in the full icon set — pre-bundle it up front so vite
      // doesn't re-optimize (and 504) when it's first hit mid-session.
      include: ["lucide-react"],
      exclude: ["better-sqlite3"],
    },
  };
});
