import test from "node:test";
import assert from "node:assert/strict";
import { compareBenchmarks, compareReports } from "../src/comparison.js";

function analysis(overrides = {}) {
  return { schemaVersion: 1, score: 95, summary: { errors: 0, warnings: 0, info: 0 }, issues: [], ...overrides };
}

test("compares fingerprinted analysis baselines without line sensitivity", () => {
  const issue = { rule: "x", file: "a.js", message: "slow", severity: "warning", line: 1, fingerprint: "stable" };
  const base = analysis({ summary: { errors: 0, warnings: 1, info: 0 }, issues: [issue] });
  const comparison = compareReports(base, { ...base, issues: [{ ...issue, line: 20 }] });
  assert.equal(comparison.newIssues.length, 0); assert.equal(comparison.resolvedIssues.length, 0);
});

test("falls back to semantic issue keys and reports new, resolved and summary deltas", () => {
  const oldIssue = { rule: "old", file: "a.js", message: "old", severity: "info", line: 1 };
  const newIssue = { rule: "new", file: "b.js", message: "new", severity: "error", line: 2 };
  const result = compareReports(
    analysis({ version: 1, schemaVersion: undefined, score: 90, summary: { errors: 0, warnings: 0, info: 1 }, issues: [oldIssue] }),
    analysis({ score: 80, summary: { errors: 1, warnings: 0, info: 0 }, issues: [newIssue] })
  );
  assert.deepEqual(result.newIssues, [newIssue]);
  assert.deepEqual(result.resolvedIssues, [oldIssue]);
  assert.deepEqual(result.summaryDelta, { errors: 1, warnings: 0, info: -1 });
  assert.equal(result.scoreDelta, -10);
});

test("rejects malformed analysis reports at every validation layer", () => {
  const valid = analysis();
  assert.throws(() => compareReports({}, valid), /not a compatible/);
  assert.throws(() => compareReports({ ...valid, summary: null }, valid), /missing required/);
  assert.throws(() => compareReports({ ...valid, issues: null }, valid), /missing required/);
  assert.throws(() => compareReports({ ...valid, score: NaN }, valid), /missing required/);
  assert.throws(() => compareReports({ ...valid, summary: { ...valid.summary, errors: 0.5 } }, valid), /summary\.errors/);
  assert.throws(() => compareReports({ ...valid, summary: { ...valid.summary, warnings: null } }, valid), /summary\.warnings/);
  assert.throws(() => compareReports({ ...valid, summary: { ...valid.summary, info: "0" } }, valid), /summary\.info/);
  for (const issue of [
    null,
    { rule: 1, file: "a", message: "m", severity: "info" },
    { rule: "x", file: 1, message: "m", severity: "info" },
    { rule: "x", file: "a", message: 1, severity: "info" },
    { rule: "x", file: "a", message: "m", severity: "fatal" }
  ]) assert.throws(() => compareReports({ ...valid, issues: [issue] }, valid), /issues\[0\] is invalid/);
});

function benchmark(overrides = {}) { return { schemaVersion: 1, command: ["node", "x.js"], samplesMs: [100], averageMs: 100, p95Ms: 120, minMs: 90, unstable: false, environment: { nodeVersion: "v20", platform: "linux", release: "1", architecture: "x64", cpu: "CPU" }, ...overrides }; }

test("validates commands and environments before calculating regression", () => {
  const comparison = compareBenchmarks(benchmark(), benchmark({ averageMs: 120, p95Ms: 144, minMs: 99 }));
  assert.equal(Math.round(comparison.averageChangePercent), 20); assert.equal(comparison.reliable, true);
  assert.throws(() => compareBenchmarks(benchmark(), benchmark({ command: ["node", "other.js"] })), /commands differ/);
  assert.throws(() => compareBenchmarks(benchmark(), benchmark({ environment: { nodeVersion: "v22", platform: "linux", release: "1", architecture: "x64", cpu: "CPU" } })), /environments differ/);
});

test("marks unstable measurements as unreliable", () => {
  const result = compareBenchmarks(benchmark({ unstable: true }), benchmark({ unstable: true }));
  assert.equal(result.reliable, false);
  assert.ok(result.warnings.some((warning) => /Baseline/.test(warning)));
  assert.ok(result.warnings.some((warning) => /Current/.test(warning)));
});

test("allows intentional environment differences and reports every changed or unknown field", () => {
  const current = benchmark({ environment: { nodeVersion: "v22", platform: "darwin", release: "2", architecture: "arm64", cpu: undefined } });
  const result = compareBenchmarks(benchmark(), current, { allowEnvironmentMismatch: true });
  assert.equal(result.warnings.length, 5);
  assert.ok(result.warnings.some((warning) => /cpu: CPU → unknown/.test(warning)));
});

test("covers zero benchmark baselines and malformed benchmark structures", () => {
  const zero = benchmark({ averageMs: 0, p95Ms: 0, minMs: 0, samplesMs: [0] });
  const unchanged = compareBenchmarks(zero, zero);
  assert.equal(unchanged.averageChangePercent, 0);
  const infinite = compareBenchmarks(zero, benchmark({ averageMs: 1, p95Ms: 1, minMs: 1 }));
  assert.equal(infinite.averageChangePercent, Infinity);

  const invalid = [
    {},
    benchmark({ schemaVersion: 2 }),
    benchmark({ command: [] }),
    benchmark({ samplesMs: [] }),
    benchmark({ samplesMs: [NaN] }),
    benchmark({ averageMs: NaN }),
    benchmark({ p95Ms: NaN }),
    benchmark({ minMs: NaN }),
    benchmark({ environment: null })
  ];
  for (const value of invalid) assert.throws(() => compareBenchmarks(value, benchmark()), /not a compatible/);
  assert.throws(() => compareBenchmarks(benchmark(), invalid.at(-1)), /current is not a compatible/);
});
