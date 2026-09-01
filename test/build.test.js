import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeBuild, compareBuilds } from "../src/build.js";
import { temporaryFixture } from "./helpers.js";

test("builds and measures the complete React + Vite fixture", async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const report = await analyzeBuild(fixture.directory, { budgets: { maxInitialJavaScriptKb: 500, maxChunkKb: 500 } });
    assert.equal(report.framework, "Vite");
    assert.ok(report.summary.javascript.rawBytes > 100_000);
    assert.ok(report.summary.javascript.gzipBytes < report.summary.javascript.rawBytes);
    assert.ok(report.summary.javascript.brotliBytes < report.summary.javascript.gzipBytes);
    assert.ok(report.summary.css.files > 0);
    assert.equal(report.summary.images.files, 2);
    assert.ok(report.artifacts.filter((item) => item.category === "image").every((item) => item.compression === "measured" && Number.isFinite(item.gzipBytes)));
    assert.ok(Number.isFinite(report.summary.images.gzipBytes));
    assert.ok(Number.isFinite(report.summary.total.gzipBytes));
    assert.ok(report.insights.entries.length > 0);
    assert.equal(report.budgetViolations.length, 0);
  } finally { await fixture.cleanup(); }
});

test("builds and measures Next.js routes, initial chunks, public images, and budgets", async () => {
  const fixture = await temporaryFixture("next-app");
  try {
    const report = await analyzeBuild(fixture.directory, { budgets: { maxInitialJavaScriptKb: 1, maxCssKb: 10, maxAssetKb: 1000, maxTotalAssetsKb: 10_000, maxChunkKb: 1 } });
    assert.equal(report.framework, "Next.js");
    assert.ok(report.summary.initialJavaScript.rawBytes > 0);
    assert.equal(report.summary.images.files, 2);
    assert.ok(report.insights.routes.some((route) => route.route === "/"));
    assert.ok(report.budgetViolations.some((item) => item.budget === "maxInitialJavaScriptKb"));
    assert.ok(report.budgetViolations.some((item) => item.budget === "maxChunkKb"));
  } finally { await fixture.cleanup(); }
});

test("does not report fake compression for binary assets and separates largest from total asset budgets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "velocity-build-honesty-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
    const dist = path.join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, "main.js"), "export const value = '" + "x".repeat(150) + "';\n");
    await writeFile(path.join(dist, "image.png"), Buffer.alloc(120, 7));
    await writeFile(path.join(dist, "archive.zip"), Buffer.alloc(40, 9));
    const report = await analyzeBuild(root, { runBuild: false, concurrency: 2, budgets: { maxAssetKb: 0.2, maxTotalAssetsKb: 0.25 } });
    assert.deepEqual(report.artifacts.map((item) => item.file), ["archive.zip", "image.png", "main.js"]);
    assert.equal(report.artifacts.find((item) => item.file === "image.png").gzipBytes, null);
    assert.equal(report.artifacts.find((item) => item.file === "archive.zip").brotliBytes, null);
    assert.equal(report.artifacts.find((item) => item.file === "main.js").compression, "measured");
    assert.equal(report.budgetViolations.some((item) => item.budget === "maxAssetKb"), false);
    assert.equal(report.budgetViolations.some((item) => item.budget === "maxTotalAssetsKb"), true);
    const largest = await analyzeBuild(root, { runBuild: false, budgets: { maxAssetKb: 0.1 } });
    assert.equal(largest.budgetViolations.some((item) => item.budget === "maxAssetKb"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("skips compression for artifacts above the configured per-artifact read limit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "velocity-build-limit-"));
  try {
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", type: "module" }));
    const dist = path.join(root, "dist");
    await mkdir(dist, { recursive: true });
    await writeFile(path.join(dist, "main.js"), "x".repeat(2048));
    const report = await analyzeBuild(root, { runBuild: false, maxArtifactBytes: 1024 });
    assert.equal(report.artifacts[0].rawBytes, 2048);
    assert.equal(report.artifacts[0].gzipBytes, null);
    assert.equal(report.artifacts[0].compression, "skipped-size-limit");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compares compatible build measurements and rejects incompatible reports", async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const baseline = await analyzeBuild(fixture.directory);
    const current = JSON.parse(JSON.stringify(baseline));
    current.summary.total.rawBytes += 100;
    current.summary.javascript.rawBytes += 100;
    const comparison = compareBuilds(baseline, current);
    assert.equal(comparison.metrics.totalRaw.deltaBytes, 100);
    assert.throws(() => compareBuilds({ ...baseline, kind: "load" }, current), /schema v1/);
    assert.throws(() => compareBuilds(baseline, { ...current, adapter: { adapter: "next" } }), /adapters differ/);
  } finally { await fixture.cleanup(); }
});
