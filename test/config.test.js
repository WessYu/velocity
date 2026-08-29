import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, mergeConfig } from "../src/config.js";
import { createIgnoreMatcher } from "../src/discovery.js";

test("rejects unknown properties, rule IDs and invalid values with JSON paths", () => {
  assert.throws(() => mergeConfig({ surprise: true }), /\$\.surprise: unknown property/);
  assert.throws(() => mergeConfig({ rules: { "made/up": "off" } }), /\$\.rules\.made\/up: unknown rule ID/);
  assert.throws(() => mergeConfig({ minScore: 101 }), /\$\.minScore/);
});

test("ignore globs match root and nested generated files", () => {
  const ignored = createIgnoreMatcher(["node_modules", "**/*.min.js"]);
  assert.equal(ignored("node_modules/pkg/index.js"), true);
  assert.equal(ignored("bundle.min.js"), true);
  assert.equal(ignored("public/assets/bundle.min.js"), true);
  assert.equal(ignored("src/index.js"), false);
});

test("discovers the nearest ancestor config predictably", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "velocity-config-")); const child = path.join(root, "a", "b"); await mkdir(child, { recursive: true });
  await writeFile(path.join(root, "velocity.config.json"), JSON.stringify({ minScore: 88 }));
  const loaded = await loadConfig(child); assert.equal(loaded.config.minScore, 88); assert.equal(loaded.configPath, path.join(root, "velocity.config.json"));
});
