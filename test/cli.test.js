import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const cli = path.resolve("bin/velocity.js");
function run(args, cwd = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] }); let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk); child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
    child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function project(source = "export const ok = true;") { const directory = await mkdtemp(path.join(tmpdir(), "velocity-cli-")); await writeFile(path.join(directory, "index.js"), source); return directory; }

test("prints package version, global help and command help", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal((await run(["--version"])).stdout.trim(), manifest.version);
  assert.match((await run(["--help"])).stdout, /config --print/);
  assert.match((await run(["bench", "--help"])).stdout, /-- <command>/);
  for (const command of ["build", "load", "optimize", "verify"]) assert.match((await run([command, "--help"])).stdout, new RegExp(`velocity ${command}`));
});

test("runs build save/compare and bundle budgets through the CLI", async () => {
  const fixture = path.resolve("test/fixtures/vite-app");
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-build-cli-"));
  const baseline = path.join(directory, "baseline.json");
  const first = await run(["build", fixture, "--no-build", "--save", baseline, "--json"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).kind, "build");
  const compared = await run(["build", fixture, "--no-build", "--compare", baseline, "--json"]);
  assert.equal(compared.code, 0, compared.stderr);
  assert.equal(JSON.parse(compared.stdout).kind, "build-comparison");
  const budget = await run(["build", fixture, "--no-build", "--max-initial-js", "1", "--json"]);
  assert.equal(budget.code, 1);
  assert.ok(JSON.parse(budget.stdout).budgetViolations.length > 0);
});

test("runs optimization dry-run by default and verifies saved reports", async () => {
  const fixture = path.resolve("test/fixtures/vite-app");
  const dryRun = await run(["optimize", fixture, "--json"]);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).mode, "dry-run");
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-verify-cli-"));
  const base = { schemaVersion: 1, kind: "build", adapter: { adapter: "vite" }, summary: { initialJavaScript: { rawBytes: 100, brotliBytes: 100 }, javascript: { rawBytes: 100 }, css: { rawBytes: 0 }, total: { rawBytes: 100 } }, budgetViolations: [] };
  const before = path.join(directory, "before.json"); const after = path.join(directory, "after.json");
  await writeFile(before, JSON.stringify(base)); await writeFile(after, JSON.stringify(base));
  const verified = await run(["verify", fixture, "--before", before, "--after", after, "--json"]);
  assert.equal(verified.code, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).classification, "unchanged");
});

test("requires explicit fixes for apply and paired reports for verify", async () => {
  const fixture = path.resolve("test/fixtures/vite-app");
  const apply = await run(["optimize", fixture, "--apply", "--json"]);
  assert.equal(apply.code, 2); assert.match(apply.stderr, /explicit --fix/);
  const verify = await run(["verify", fixture, "--before", "one.json"]);
  assert.equal(verify.code, 2); assert.match(verify.stderr, /provided together/);
});

test("rejects unknown flags and invalid values on stderr with usage exit code", async () => {
  const unknown = await run(["analyze", "--wat"]); assert.equal(unknown.code, 2); assert.equal(unknown.stdout, ""); assert.match(unknown.stderr, /Unknown option/);
  const invalid = await run(["bench", "--runs", "zero", "--", process.execPath, "-e", "0"]); assert.equal(invalid.code, 2); assert.match(invalid.stderr, /--runs must/);
});

test("emits versioned JSON without ANSI and valid SARIF locations", async () => {
  const directory = await project('import fs from "node:fs"; fs.statSync(".");');
  const jsonRun = await run(["analyze", directory, "--format", "json"]); assert.equal(jsonRun.code, 0); assert.equal(jsonRun.stdout.includes("\u001b["), false); assert.equal(JSON.parse(jsonRun.stdout).schemaVersion, 1);
  const sarifRun = await run(["analyze", directory, "--format", "sarif"]); const sarif = JSON.parse(sarifRun.stdout); assert.equal(sarif.version, "2.1.0"); assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 1);
});

test("treats -- as an absolute child-command boundary", async () => {
  const directory = await project("if (!process.argv.includes('--json')) process.exit(9);");
  const result = await run(["bench", "--runs", "1", "--warmup", "0", "--", process.execPath, path.join(directory, "index.js"), "--json"]);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Velocity benchmark/);
});

test("keeps profile target flags after -- out of Velocity parsing", async () => {
  const directory = await project("if (!process.argv.includes('--json')) process.exit(9);");
  const result = await run(["profile", "--", process.execPath, path.join(directory, "index.js"), "--json"]);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Velocity runtime profile/);
});

test("check uses exit 1 for exceeded budgets", async () => {
  const directory = await project('import fs from "node:fs"; fs.statSync(".");'); const result = await run(["check", directory, "--no-color"]); assert.equal(result.code, 1); assert.equal(result.stderr, "");
});

test("init writes valid minimal config and refuses overwrite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-init-")); const first = await run(["init", directory]); assert.equal(first.code, 0);
  const config = JSON.parse(await readFile(path.join(directory, "velocity.config.json"), "utf8")); assert.equal(config.failOn, "error");
  const second = await run(["init", directory]); assert.equal(second.code, 2); assert.match(second.stderr, /EEXIST/);
});
