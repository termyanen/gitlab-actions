import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/**", ".reports/**", "node_modules/**"],
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["src/**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // API boundaries deliberately replace external errors with safe messages.
      "preserve-caught-error": "off",
      // Protocol validation intentionally rejects ASCII control characters.
      "no-control-regex": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
        },
      ],
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: false },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/no-duplicate-type-constituents": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      // Store transport must not expose OAuth/network error bodies.
      "preserve-caught-error": "off",
    },
  },
  {
    // Playwright evaluates these functions inside Chromium extension pages.
    files: ["scripts/profile-runtime.mjs"],
    languageOptions: { globals: { ...globals.browser, chrome: "readonly" } },
  },
);
