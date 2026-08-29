import test from "node:test";
import assert from "node:assert/strict";
import { compareBenchmarks, compareReports } from "../src/comparison.js";

test("compares fingerprinted analysis baselines without line sensitivity", () => {
  const issue = { rule: "x", file: "a.js", message: "slow", severity: "warning", line: 1, fingerprint: "stable" };
  const base = { schemaVersion: 1, score: 95, summary: { errors: 0, warnings: 1, info: 0 }, issues: [issue] };
  const comparison = compareReports(base, { ...base, issues: [{ ...issue, line: 20 }] });
  assert.equal(comparison.newIssues.length, 0); assert.equal(comparison.resolvedIssues.length, 0);
});

function benchmark(overrides = {}) { return { schemaVersion: 1, command: ["node", "x.js"], samplesMs: [100], averageMs: 100, p95Ms: 120, minMs: 90, unstable: false, environment: { nodeVersion: "v20", platform: "linux", architecture: "x64", cpu: "CPU" }, ...overrides }; }
test("validates commands and environments before calculating regression", () => {
  const comparison = compareBenchmarks(benchmark(), benchmark({ averageMs: 120, p95Ms: 144, minMs: 99 }));
  assert.equal(Math.round(comparison.averageChangePercent), 20); assert.equal(comparison.reliable, true);
  assert.throws(() => compareBenchmarks(benchmark(), benchmark({ command: ["node", "other.js"] })), /commands differ/);
  assert.throws(() => compareBenchmarks(benchmark(), benchmark({ environment: { nodeVersion: "v22", platform: "linux", architecture: "x64", cpu: "CPU" } })), /environments differ/);
});

test("marks unstable measurements as unreliable", () => {
  const result = compareBenchmarks(benchmark({ unstable: true }), benchmark()); assert.equal(result.reliable, false); assert.ok(result.warnings.length);
});
