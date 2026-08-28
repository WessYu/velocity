import test from "node:test";
import assert from "node:assert/strict";
import { compareBenchmarks, compareReports } from "../src/comparison.js";

const issue = { rule: "x", file: "a.js", message: "slow", severity: "warning", line: 1 };

test("compares analysis baselines without treating moved lines as new issues", () => {
  const baseline = { version: 1, score: 95, summary: { errors: 0, warnings: 1, info: 0 }, issues: [issue] };
  const current = { version: 1, score: 95, summary: { errors: 0, warnings: 1, info: 0 }, issues: [{ ...issue, line: 20 }] };
  const comparison = compareReports(baseline, current);
  assert.equal(comparison.newIssues.length, 0);
  assert.equal(comparison.resolvedIssues.length, 0);
});

test("calculates benchmark regression percentages", () => {
  const baseline = { samplesMs: [100], averageMs: 100, p95Ms: 120, minMs: 90 };
  const current = { samplesMs: [120], averageMs: 120, p95Ms: 144, minMs: 99 };
  const comparison = compareBenchmarks(baseline, current);
  assert.equal(Math.round(comparison.averageChangePercent), 20);
  assert.equal(Math.round(comparison.p95ChangePercent), 20);
  assert.equal(Math.round(comparison.minChangePercent), 10);
});
