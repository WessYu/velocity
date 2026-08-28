export const defaultConfig = Object.freeze({
  minScore: 70,
  maxFileSizeKb: 250,
  failOn: "error",
  rules: {},
  ignore: [
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".output",
    "vendor"
  ]
});

const severities = new Set(["info", "warning", "error"]);

export function mergeConfig(input = {}) {
  const config = { ...defaultConfig, ...input };

  if (!Number.isFinite(config.minScore) || config.minScore < 0 || config.minScore > 100) {
    throw new Error("minScore must be a number between 0 and 100");
  }

  if (!Number.isFinite(config.maxFileSizeKb) || config.maxFileSizeKb <= 0) {
    throw new Error("maxFileSizeKb must be greater than zero");
  }

  if (!severities.has(config.failOn)) {
    throw new Error("failOn must be info, warning or error");
  }

  if (!Array.isArray(config.ignore) || config.ignore.some((item) => typeof item !== "string")) {
    throw new Error("ignore must be an array of directory names");
  }

  if (!config.rules || typeof config.rules !== "object" || Array.isArray(config.rules)) {
    throw new Error("rules must be an object mapping rule IDs to severities or off");
  }

  for (const [ruleId, value] of Object.entries(config.rules)) {
    if (!["off", "info", "warning", "error"].includes(value)) {
      throw new Error(`Invalid setting for rule ${ruleId}: use off, info, warning or error`);
    }
  }

  return config;
}
