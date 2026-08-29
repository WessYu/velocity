import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyOptimizations, createOptimizationPlan, verifyProject } from "../src/optimize.js";
import { temporaryFixture } from "./helpers.js";

test("dry-run emits classified evidence, impact, risk, files, and reviewable patches", async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const plan = await createOptimizationPlan(fixture.directory);
    assert.equal(plan.mode, "dry-run");
    assert.equal(plan.framework, "Vite");
    assert.ok(plan.optimizations.some((item) => item.classification === "safe-fix"));
    assert.equal(plan.optimizations.some((item) => item.id.startsWith("lazy-image-")), false);
    assert.ok(plan.findings.some((item) => item.id === "image/review-loading-policy"));
    for (const item of plan.optimizations) {
      assert.ok(item.evidence && item.expectedImpact && item.risk);
      assert.ok(item.files.length && item.patch && item.diff.includes("Index:"));
    }
  } finally { await fixture.cleanup(); }
});

test("apply changes only an authorized safe fix, validates the project, and creates a scoped snapshot", { timeout: 60_000 }, async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const unrelated = path.join(fixture.directory, "user-change.txt");
    await writeFile(unrelated, "preserve me\n");
    const plan = await createOptimizationPlan(fixture.directory);
    const fix = plan.optimizations.find((item) => item.classification === "safe-fix");
    const run = await applyOptimizations(fixture.directory, { fixes: [fix.id] });
    assert.equal(run.rolledBack.length, 0);
    assert.ok(run.validation.passed);
    assert.match(await readFile(path.join(fixture.directory, fix.files[0]), "utf8"), /width=\{1200\}/);
    assert.equal(await readFile(unrelated, "utf8"), "preserve me\n");
    const manifest = JSON.parse(await readFile(path.join(fixture.directory, run.snapshot), "utf8"));
    assert.deepEqual(manifest.files.map((entry) => entry.file), fix.files);
    const verification = await verifyProject(fixture.directory);
    assert.equal(verification.runId, run.id);
  } finally { await fixture.cleanup(); }
});

test("does not infer lazy-loading safety from JSX source order", async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const sourceFile = path.join(fixture.directory, "src", "App.jsx");
    const original = await readFile(sourceFile, "utf8");
    const plan = await createOptimizationPlan(fixture.directory);
    assert.equal(plan.optimizations.some((item) => item.diff?.includes('loading="lazy"')), false);
    const finding = plan.findings.find((item) => item.id === "image/review-loading-policy");
    assert.ok(finding);
    assert.match(finding.recommendation, /real load measurement/);
    assert.equal(await readFile(sourceFile, "utf8"), original);
  } finally { await fixture.cleanup(); }
});

test("restores only Velocity changes when post-apply validation fails", { timeout: 60_000 }, async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const sourceFile = path.join(fixture.directory, "src", "App.jsx");
    const original = await readFile(sourceFile, "utf8");
    await writeFile(path.join(fixture.directory, "vite.config.js"), "import{readFileSync}from'node:fs';const source=readFileSync('src/App.jsx','utf8');if(source.includes('width={1200}'))throw new Error('fixture build regression');export default{build:{manifest:true}};\n");
    const plan = await createOptimizationPlan(fixture.directory);
    const fix = plan.optimizations.find((item) => item.classification === "safe-fix");
    const run = await applyOptimizations(fixture.directory, { fixes: [fix.id] });
    assert.equal(run.verification.classification, "failed");
    assert.deepEqual(run.rolledBack, [fix.id]);
    assert.equal(await readFile(sourceFile, "utf8"), original);
    assert.equal(run.validation.steps[0].name, "build");
    assert.equal(run.validation.steps[0].status, "failed");
    assert.match(await readFile(path.join(fixture.directory, "vite.config.js"), "utf8"), /fixture build regression/);
  } finally { await fixture.cleanup(); }
});

test("verify compares saved build reports and reports incompatible kinds as failed", async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const before = path.join(fixture.directory, "before.json");
    const after = path.join(fixture.directory, "after.json");
    const base = { schemaVersion: 1, kind: "build", adapter: { adapter: "vite" }, summary: { initialJavaScript: { rawBytes: 100, brotliBytes: 100 }, javascript: { rawBytes: 100 }, css: { rawBytes: 0 }, total: { rawBytes: 100 } }, budgetViolations: [] };
    await writeFile(before, JSON.stringify(base));
    await writeFile(after, JSON.stringify({ ...base, summary: { ...base.summary, initialJavaScript: { rawBytes: 80, brotliBytes: 80 }, total: { rawBytes: 80 } } }));
    assert.equal((await verifyProject(fixture.directory, { before, after, marginPercent: 2 })).classification, "improved");
    await writeFile(after, JSON.stringify({ ...base, kind: "load" }));
    assert.equal((await verifyProject(fixture.directory, { before, after })).classification, "failed");
  } finally { await fixture.cleanup(); }
});

test("apply requires explicit and known optimization IDs", async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    await assert.rejects(applyOptimizations(fixture.directory), /explicit --fix/);
    await assert.rejects(applyOptimizations(fixture.directory, { fixes: ["unknown"] }), /Unknown optimization ID/);
  } finally { await fixture.cleanup(); }
});
