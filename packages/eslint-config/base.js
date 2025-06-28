import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";
import onlyWarn from "eslint-plugin-only-warn";

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
      onlyWarn,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    ignores: [
      "dist/**",
      ".vite/**",
      "build/**",
      "node_modules/**",
      ".turbo/**",
      "coverage/**",
      ".next/**",
      "out/**",
      "*.min.js",
      "*.bundle.js",
      // ignore shadcn ui components
      "src/components/ui/**",
      "components/ui/**",
    ],
  },
];
