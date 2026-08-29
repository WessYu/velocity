import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBuild, compareBuilds } from "../src/build.js";
import { fixtureRoot } from "./helpers.js";

test("builds and measures the complete React + Vite fixture", async () => {
  const report = await analyzeBuild(fixtureRoot("vite-app"), { budgets: { maxInitialJavaScriptKb: 500, maxChunkKb: 500 } });
  assert.equal(report.framework, "Vite");
  assert.ok(report.summary.javascript.rawBytes > 100_000);
  assert.ok(report.summary.javascript.gzipBytes < report.summary.javascript.rawBytes);
  assert.ok(report.summary.javascript.brotliBytes < report.summary.javascript.gzipBytes);
  assert.ok(report.summary.css.files > 0);
  assert.ok(report.summary.images.files === 2);
  assert.ok(report.insights.entries.length > 0);
  assert.equal(report.budgetViolations.length, 0);
});

test("builds and measures Next.js routes, initial chunks, public images, and budgets", async () => {
  const report = await analyzeBuild(fixtureRoot("next-app"), { budgets: { maxInitialJavaScriptKb: 1, maxCssKb: 10, maxAssetKb: 1000, maxChunkKb: 1 } });
  assert.equal(report.framework, "Next.js");
  assert.ok(report.summary.initialJavaScript.rawBytes > 0);
  assert.equal(report.summary.images.files, 2);
  assert.ok(report.insights.routes.some((route) => route.route === "/"));
  assert.ok(report.budgetViolations.some((item) => item.budget === "maxInitialJavaScriptKb"));
  assert.ok(report.budgetViolations.some((item) => item.budget === "maxChunkKb"));
});

test("compares compatible build measurements and rejects incompatible reports", async () => {
  const baseline = await analyzeBuild(fixtureRoot("vite-app"), { runBuild: false });
  const current = JSON.parse(JSON.stringify(baseline));
  current.summary.total.rawBytes += 100;
  current.summary.javascript.rawBytes += 100;
  const comparison = compareBuilds(baseline, current);
  assert.equal(comparison.metrics.totalRaw.deltaBytes, 100);
  assert.throws(() => compareBuilds({ ...baseline, kind: "load" }, current), /schema v1/);
  assert.throws(() => compareBuilds(baseline, { ...current, adapter: { adapter: "next" } }), /adapters differ/);
});
