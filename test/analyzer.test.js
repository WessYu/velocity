import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeProject } from "../src/analyzer.js";

async function fixture(source) {
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-test-"));
  await writeFile(path.join(directory, "index.js"), source);
  return directory;
}

test("detects blocking filesystem calls with line numbers", async () => {
  const directory = await fixture('import fs from "node:fs";\n\nconst data = fs.readFileSync("data.json");\n');
  const report = await analyzeProject(directory);
  assert.equal(report.summary.files, 1);
  assert.equal(report.summary.errors, 1);
  assert.equal(report.issues[0].rule, "node/no-blocking-fs");
  assert.equal(report.issues[0].line, 3);
});

test("detects await inside a conventional loop", async () => {
  const directory = await fixture('async function load(ids) {\n  for (const id of ids) {\n    await fetch(`/items/${id}`);\n  }\n}\n');
  const report = await analyzeProject(directory);
  assert.ok(report.issues.some((issue) => issue.rule === "async/no-await-in-loop"));
  assert.ok(report.score < 100);
});

test("returns a perfect score for a small clean module", async () => {
  const directory = await fixture("export const add = (a, b) => a + b;\n");
  const report = await analyzeProject(directory);
  assert.equal(report.score, 100);
  assert.deepEqual(report.issues, []);
});

test("does not report examples written inside comments or strings", async () => {
  const directory = await fixture('// fs.readFileSync("example")\nconst docs = "execSync()";\nconst matcher = /spawnSync\\(/;\n');
  const report = await analyzeProject(directory);
  assert.equal(report.score, 100);
  assert.deepEqual(report.issues, []);
});

test("supports narrow inline suppressions with a reason", async () => {
  const directory = await fixture('// velocity-ignore-next-line node/no-blocking-fs -- process shutdown\nfs.writeFileSync("report.json", data);\n');
  const report = await analyzeProject(directory);
  assert.equal(report.score, 100);
});

test("allows rule severity overrides", async () => {
  const directory = await fixture('fs.readFileSync("data.json");\n');
  const report = await analyzeProject(directory, { config: { rules: { "node/no-blocking-fs": "info" } } });
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.info, 1);
});
