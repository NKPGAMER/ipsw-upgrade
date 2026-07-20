import tseslint from "typescript-eslint";
import eslint from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const commonTS = tseslint.config({
  extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "off",
  },
});

// ─── Frontend: src/ ───────────────────────────────────────────────────────

const frontend = tseslint.config({
  files: ["src/**/*.{ts,tsx}"],
  extends: [
    ...commonTS,
    reactPlugin.configs.flat?.recommended ?? reactPlugin.configs.recommended,
    reactPlugin.configs.flat?.["jsx-runtime"] ??
      reactPlugin.configs["jsx-runtime"],
  ],
  plugins: {
    react: reactPlugin,
    "react-hooks": reactHooks,
  },
  languageOptions: {
    globals: {
      ...globals.browser,
      ...globals.node,
    },
  },
  settings: {
    react: { version: "19.0" },
  },
  rules: {
    "react/prop-types": "off",
    "react/display-name": "warn",
    ...reactHooks.configs.recommended?.rules,
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/set-state-in-effect": "warn",
    "react-hooks/immutability": "warn",
    "react-hooks/refs": "warn",
  },
});

// ─── Backend: electron/ ───────────────────────────────────────────────────

const backend = tseslint.config({
  files: ["electron/**/*.ts"],
  extends: [...commonTS],
  languageOptions: {
    globals: {
      ...globals.node,
    },
  },
  rules: {
    "@typescript-eslint/no-require-imports": "off",
    "@typescript-eslint/no-var-requires": "off",
    // Empty catch blocks are idiomatic for cleanup (fs.closeSync, removeHandler, etc.)
    "no-empty": "off",
    // Control chars in regex are valid for filename sanitization
    "no-control-regex": "off",
    // Catch-and-rethrow with enriched message is intentional here
    "preserve-caught-error": "off",
    // Ternary used as statement is valid in this codebase
    "@typescript-eslint/no-unused-expressions": [
      "error",
      { allowTernary: true },
    ],
  },
});

// ─── Type-declaration files ───────────────────────────────────────────────

const declarationFiles = tseslint.config({
  files: ["*.d.ts", "**/*.d.ts"],
  extends: [...commonTS],
  rules: {
    "@typescript-eslint/no-unused-vars": "off",
  },
});

// ─── Config files (root) ──────────────────────────────────────────────────

const rootConfig = tseslint.config({
  files: ["*.config.{ts,mjs,js}"],
  extends: [...commonTS],
  languageOptions: {
    globals: { ...globals.node },
  },
});

export default tseslint.config(
  { ignores: ["dist/**", "src/dist/**", "electron/dist/**", "node_modules/**", "release/**", "electron/i10r-addon/**", "publish"] },
  ...commonTS,
  ...frontend,
  ...backend,
  ...declarationFiles,
  ...rootConfig,
);
