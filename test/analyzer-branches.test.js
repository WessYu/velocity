import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeProject } from "../src/analyzer.js";

async function project(source, config) {
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-analyzer-branches-"));
  const file = path.join(directory, "index.js");
  await writeFile(file, source);
  if (config) await writeFile(path.join(directory, "velocity.config.json"), JSON.stringify(config));
  return { directory, file };
}

test("reports parser failures instead of aborting project analysis", async () => {
  const fixture = await project("export const broken = ;");
  const report = await analyzeProject(fixture.directory);
  assert.equal(report.issues.length, 1);
  assert.equal(report.issues[0].rule, "velocity/parse-error");
  assert.equal(report.issues[0].severity, "error");
  assert.equal(report.summary.errors, 1);
});

test("analyzes a single source-file target and applies the large-file rule", async () => {
  const fixture = await project(`export const payload = "${"x".repeat(2048)}";`, { maxFileSizeKb: 1 });
  const report = await analyzeProject(fixture.file, { config: { maxFileSizeKb: 1 } });
  assert.equal(report.summary.files, 1);
  assert.ok(report.issues.some((issue) => issue.rule === "project/large-source-file"));
});

test("skips disabled core rules while retaining enabled analysis", async () => {
  const fixture = await project('import fs from "node:fs"; fs.statSync(".");');
  const report = await analyzeProject(fixture.directory, { config: { rules: { "node/no-blocking-fs": "off" } } });
  assert.equal(report.issues.some((issue) => issue.rule === "node/no-blocking-fs"), false);
});
