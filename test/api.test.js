import test from "node:test";
import assert from "node:assert/strict";
import * as velocity from "../src/index.js";

test("public ESM API exposes only documented entry points", () => {
  assert.deepEqual(Object.keys(velocity).sort(), ["ConfigError", "analyzeProject", "benchmark", "compareBenchmarks", "compareReports", "defaultConfig", "getRuleCatalog", "loadConfig", "mergeConfig", "profileNodeProcess", "toSarif"]);
  assert.ok(velocity.getRuleCatalog().every((rule) => rule.id && rule.rationale && !Object.hasOwn(rule, "analyze")));
});
