import path from "node:path";
import { access, readFile, stat } from "node:fs/promises";
import { allRules, ruleById } from "./rules/core.js";

const defaultIgnore = ["node_modules", ".git", ".velocity", "dist", "build", "coverage", ".next", ".nuxt", ".output", "vendor", "**/*.min.js"];
export const defaultConfig = Object.freeze({
  minScore: 70,
  maxFileSizeKb: 250,
  failOn: "error",
  rules: Object.freeze(Object.fromEntries(allRules.map((rule) => [rule.id, rule.defaultSeverity]))),
  ignore: Object.freeze(defaultIgnore),
  bundleBudgets: Object.freeze({})
});

const allowedKeys = new Set(["$schema", "minScore", "maxFileSizeKb", "failOn", "rules", "ignore", "bundleBudgets"]);
const settings = new Set(["off", "info", "warning", "error"]);
const budgetKeys = new Set(["maxInitialJavaScriptKb", "maxTotalJavaScriptKb", "maxCssKb", "maxAssetKb", "maxTotalAssetsKb", "maxChunkKb"]);

export class ConfigError extends Error {
  constructor(propertyPath, message) {
    super(`${propertyPath}: ${message}`);
    this.name = "ConfigError";
    this.propertyPath = propertyPath;
  }
}

/** @param {Record<string, any>} input */
export function mergeConfig(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ConfigError("$", "must be an object");
  for (const key of Object.keys(input)) if (!allowedKeys.has(key)) throw new ConfigError(`$.${key}`, "unknown property");
  if ("minScore" in input && (!Number.isFinite(input.minScore) || input.minScore < 0 || input.minScore > 100)) throw new ConfigError("$.minScore", "must be a number between 0 and 100");
  if ("maxFileSizeKb" in input && (!Number.isFinite(input.maxFileSizeKb) || input.maxFileSizeKb <= 0)) throw new ConfigError("$.maxFileSizeKb", "must be a number greater than zero");
  if ("failOn" in input && !["off", "info", "warning", "error"].includes(input.failOn)) throw new ConfigError("$.failOn", "must be off, info, warning, or error");
  if ("ignore" in input && (!Array.isArray(input.ignore) || input.ignore.some((item) => typeof item !== "string" || !item.trim()))) throw new ConfigError("$.ignore", "must be an array of non-empty glob patterns");
  if ("rules" in input && (!input.rules || typeof input.rules !== "object" || Array.isArray(input.rules))) throw new ConfigError("$.rules", "must be an object");
  for (const [ruleId, value] of Object.entries(input.rules ?? {})) {
    if (!ruleById.has(ruleId)) throw new ConfigError(`$.rules.${ruleId}`, "unknown rule ID");
    if (!settings.has(value)) throw new ConfigError(`$.rules.${ruleId}`, "must be off, info, warning, or error");
  }
  if ("bundleBudgets" in input && (!input.bundleBudgets || typeof input.bundleBudgets !== "object" || Array.isArray(input.bundleBudgets))) throw new ConfigError("$.bundleBudgets", "must be an object");
  for (const [key, value] of Object.entries(input.bundleBudgets ?? {})) {
    if (!budgetKeys.has(key)) throw new ConfigError(`$.bundleBudgets.${key}`, "unknown bundle budget");
    if (!Number.isFinite(value) || value <= 0) throw new ConfigError(`$.bundleBudgets.${key}`, "must be a positive number in KiB");
  }
  return {
    minScore: input.minScore ?? defaultConfig.minScore,
    maxFileSizeKb: input.maxFileSizeKb ?? defaultConfig.maxFileSizeKb,
    failOn: input.failOn ?? defaultConfig.failOn,
    rules: { ...defaultConfig.rules, ...(input.rules ?? {}) },
    ignore: [...(input.ignore ?? defaultConfig.ignore)],
    bundleBudgets: { ...(input.bundleBudgets ?? defaultConfig.bundleBudgets) }
  };
}

async function exists(file) { try { await access(file); return true; } catch { return false; } }

export async function findConfigPath(target) {
  const resolved = path.resolve(target);
  let directory;
  try { directory = (await stat(resolved)).isFile() ? path.dirname(resolved) : resolved; } catch { directory = path.extname(resolved) ? path.dirname(resolved) : resolved; }
  while (true) {
    const candidate = path.join(directory, "velocity.config.json");
    // velocity-ignore-next-line async/no-await-in-loop -- nearest-ancestor discovery is ordered and stops at the first match
    if (await exists(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export async function loadConfig(target) {
  const configPath = await findConfigPath(target);
  if (!configPath) return { config: mergeConfig(), configPath: null };
  let parsed;
  try { parsed = JSON.parse(await readFile(configPath, "utf8")); }
  catch (error) { throw new ConfigError("$", `could not parse ${configPath}: ${error.message}`); }
  return { config: mergeConfig(parsed), configPath };
}
