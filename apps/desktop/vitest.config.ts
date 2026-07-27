import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{js,ts}"],
    exclude: ["node_modules", ".vite", "out"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000, // 30 seconds for full app initialization
    hookTimeout: 30000,
    // Run tests sequentially to avoid database conflicts
    threads: false,
    // Isolate environment for each test file
    isolate: true,
  },
  resolve: {
    alias: {
      // Forge rebuilds an app-local copy for Electron. Tests run in Node, so
      // always use pnpm's hoisted Node-compatible binding instead.
      "better-sqlite3": resolve(__dirname, "../../node_modules/better-sqlite3"),
      // Renderer tests (jsdom) can't load the real tRPC React client; point it at
      // a stub. Must precede "@" so it wins over the generic src alias.
      "@/trpc/react": resolve(__dirname, "tests/stubs/trpc-react.ts"),
      "@": resolve(__dirname, "src"),
      "@db": resolve(__dirname, "src/db"),
      "@main": resolve(__dirname, "src/main"),
      "@services": resolve(__dirname, "src/services"),
      "@utils": resolve(__dirname, "src/utils"),
      "@trpc": resolve(__dirname, "src/trpc"),
    },
  },
});
