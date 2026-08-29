import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeProject } from "../src/analyzer.js";

async function fixture(source, extension = ".js", config) {
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-test-"));
  await writeFile(path.join(directory, `index${extension}`), source);
  if (config) await writeFile(path.join(directory, "velocity.config.json"), JSON.stringify(config));
  return directory;
}

test("recognizes every supported fs import style", async () => {
  const variants = [
    'import fs from "node:fs"; fs.readFileSync("a");',
    'import * as fs from "node:fs"; fs.readFileSync("a");',
    'import { readFileSync as read } from "node:fs"; read("a");',
    'const fs = require("node:fs"); fs.readFileSync("a");',
    'const { readFileSync: read } = require("node:fs"); read("a");'
  ];
  for (const source of variants) {
    const report = await analyzeProject(await fixture(source));
    assert.equal(report.issues.filter((issue) => issue.rule === "node/no-blocking-fs").length, 1, source);
  }
});

test("does not confuse user functions or shadowed imports with node:fs", async () => {
  const report = await analyzeProject(await fixture('import { readFileSync } from "node:fs"; function local(readFileSync) { readFileSync(); } local(() => {});'));
  assert.equal(report.issues.filter((issue) => issue.rule === "node/no-blocking-fs").length, 0);
});

test("does not treat a user-defined require function as CommonJS", async () => {
  const report = await analyzeProject(await fixture('function require() { return { readFileSync() {} }; } const fs = require("node:fs"); fs.readFileSync("x");'));
  assert.equal(report.issues.filter((issue) => issue.rule === "node/no-blocking-fs").length, 0);
});

test("resolves var declarations in their function scope", async () => {
  const report = await analyzeProject(await fixture('{ var setInterval = () => 1; } setInterval(work, 1000);'));
  assert.equal(report.issues.filter((issue) => issue.rule === "runtime/track-interval").length, 0);
});

test("finds child process calls only through module bindings", async () => {
  const report = await analyzeProject(await fixture('const { execSync: run } = require("child_process"); run("echo ok"); function execSync() {} execSync();'));
  assert.deepEqual(report.issues.filter((issue) => issue.rule === "node/no-sync-process").map((issue) => issue.line), [1]);
});

test("parses JS, JSX, TypeScript and TSX including template expressions", async () => {
  const cases = [
    [".js", 'import fs from "node:fs"; `${fs.statSync(".")}`;'],
    [".jsx", 'import fs from "node:fs"; export const View = () => <div>{fs.statSync(".").size}</div>;'],
    [".ts", 'import fs from "node:fs"; const size: number = fs.statSync(".").size;'],
    [".tsx", 'import fs from "node:fs"; export const View = (): JSX.Element => <div>{fs.statSync(".").size}</div>;']
  ];
  for (const [extension, source] of cases) {
    const report = await analyzeProject(await fixture(source, extension));
    assert.equal(report.issues.filter((issue) => issue.rule === "node/no-blocking-fs").length, 1, extension);
  }
});

test("parses TypeScript declaration files", async () => {
  const report = await analyzeProject(await fixture("export declare const version: string;", ".d.ts"));
  assert.deepEqual(report.issues, []);
});

test("does not report code-shaped text in comments, strings, or regex literals", async () => {
  const report = await analyzeProject(await fixture('// fs.readFileSync("x")\nconst docs = "execSync()"; const matcher = /spawnSync\\(/;'));
  assert.deepEqual(report.issues, []);
});

test("reports contextual await in nested loops but not inside a nested function", async () => {
  const report = await analyzeProject(await fixture('async function run(xs) { for (const x of xs) { if (x) await work(x); const later = async () => await work(x); } }'));
  assert.equal(report.issues.filter((issue) => issue.rule === "async/no-await-in-loop").length, 1);
  assert.match(report.issues[0].suggestion, /rate limits/);
});

test("detects DOM queries in loops only for the unshadowed browser global", async () => {
  const positive = await analyzeProject(await fixture('for (const x of xs) { document.querySelector(x); }'));
  const negative = await analyzeProject(await fixture('function render(document) { for (const x of xs) document.querySelector(x); }'));
  assert.equal(positive.issues.filter((issue) => issue.rule === "browser/no-dom-query-in-loop").length, 1);
  assert.equal(negative.issues.length, 0);
});

test("detects three collection passes and discarded intervals", async () => {
  const report = await analyzeProject(await fixture('items.filter(ok).map(view).reduce(join, "");\nsetInterval(tick, 1000);\nconst timer = setInterval(tick, 1000);\ntimers.push(setInterval(tick, 1000));'));
  assert.ok(report.issues.some((issue) => issue.rule === "js/repeated-array-passes"));
  assert.equal(report.issues.filter((issue) => issue.rule === "runtime/track-interval").length, 1);
});

test("requires valid, justified suppressions and reports stale directives", async () => {
  const valid = await analyzeProject(await fixture('import fs from "node:fs";\n// velocity-ignore-next-line node/no-blocking-fs -- required at process exit\nfs.writeFileSync("x", "y");'));
  assert.equal(valid.issues.length, 0);
  const invalid = await analyzeProject(await fixture('// velocity-ignore-next-line unknown/rule -- because\nwork();\n// velocity-ignore-next-line async/no-await-in-loop\nwork();'));
  assert.equal(invalid.issues.filter((issue) => issue.rule === "velocity/invalid-suppression").length, 2);
  const unused = await analyzeProject(await fixture('// velocity-ignore-next-line async/no-await-in-loop -- reviewed\nwork();'));
  assert.equal(unused.issues[0].rule, "velocity/unused-suppression");
});

test("all rules including large files honor configuration", async () => {
  const source = `import fs from "node:fs"; fs.readFileSync("x"); ${"x".repeat(2048)}`;
  const directory = await fixture(source, ".js", { maxFileSizeKb: 1, rules: { "node/no-blocking-fs": "info", "project/large-source-file": "off" } });
  const report = await analyzeProject(directory);
  assert.equal(report.summary.info, 1); assert.equal(report.summary.warnings, 0); assert.equal(report.summary.errors, 0);
});

test("fingerprints survive line movement and distinguish semantic contexts", async () => {
  const first = await analyzeProject(await fixture('import fs from "node:fs";\nfunction a(){fs.statSync(".");}\nfunction b(){fs.statSync(".");}'));
  const moved = await analyzeProject(await fixture('import fs from "node:fs";\n\n\nfunction a(){fs.statSync(".");}\nfunction b(){fs.statSync(".");}'));
  assert.deepEqual(first.issues.map((issue) => issue.fingerprint), moved.issues.map((issue) => issue.fingerprint));
  assert.notEqual(first.issues[0].fingerprint, first.issues[1].fingerprint);
});
