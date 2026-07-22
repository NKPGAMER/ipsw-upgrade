import tseslint from "typescript-eslint";
import eslint from "@eslint/js";
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
  extends: [...commonTS],
  plugins: {
    "react-hooks": reactHooks,
  },
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
    globals: {
      ...globals.browser,
    },
  },
  rules: {
    ...reactHooks.configs.recommended.rules,
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
    "no-empty": "off",
    "no-control-regex": "off",
    "preserve-caught-error": "off",
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
