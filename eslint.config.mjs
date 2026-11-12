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
  {
    files: [
      "src/**/*.ts",
      "scripts/sandbox/prepare.mjs",
      "scripts/sandbox/assert.mjs",
      "scripts/contracts.mjs",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message:
            "Use the shared CCv2 client for OAuth and Management API transport.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "globalThis",
          property: "fetch",
          message: "Use the shared CCv2 client.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["ajv", "ajv/*", "ajv-formats", "ajv-formats/*"],
              message: "Use the shared notification-contract validator.",
            },
          ],
        },
      ],
    },
  },
);
