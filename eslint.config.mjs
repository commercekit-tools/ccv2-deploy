import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";
export default ts.config(
  { ignores: ["dist/**", "coverage/**", "node_modules/**", ".idea/**"] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: { "no-control-regex": "off" },
  },
);
