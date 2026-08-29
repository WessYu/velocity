import js from "@eslint/js";

const nodeGlobals = {
  Buffer: "readonly",
  URL: "readonly",
  clearInterval: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly"
};

export default [
  { ignores: ["node_modules/**", "coverage/**", ".velocity/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: nodeGlobals },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }] }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { ...nodeGlobals, module: "readonly", require: "readonly" } }
  }
];
