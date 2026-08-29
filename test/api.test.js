import test from "node:test";
import assert from "node:assert/strict";
import * as velocity from "../src/index.js";

const documentedExports = [
  "ConfigError",
  "analyzeBuild",
  "analyzeProject",
  "applyOptimizations",
  "benchmark",
  "compareBenchmarks",
  "compareBuilds",
  "compareLoads",
  "compareReports",
  "createOptimizationPlan",
  "defaultConfig",
  "getRuleCatalog",
  "loadConfig",
  "measureLoad",
  "mergeConfig",
  "profileNodeProcess",
  "toSarif",
  "verifyProject"
];

test("public ESM API exposes only documented entry points", () => {
  assert.deepEqual(Object.keys(velocity).sort(), documentedExports);
  assert.ok(velocity.getRuleCatalog().every((rule) => rule.id && rule.rationale && !Object.hasOwn(rule, "analyze")));
});
