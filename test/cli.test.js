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
  const first = await run(["build", fixture, "--save", baseline, "--json"]);
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

test("covers global aliases, option parser edge cases and command validation", async () => {
  assert.match((await run([])).stdout, /Velocity/);
  assert.match((await run(["-h"])).stdout, /Usage:/);
  const manifest = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
  assert.equal((await run(["-v"])).stdout.trim(), manifest.version);

  const versionArgs = await run(["--version", "extra"]);
  assert.equal(versionArgs.code, 2); assert.match(versionArgs.stderr, /does not accept arguments/);
  const unknownCommand = await run(["definitely-unknown"]);
  assert.equal(unknownCommand.code, 2); assert.match(unknownCommand.stderr, /Unknown command/);
  const booleanValue = await run(["rules", "--json=true"]);
  assert.equal(booleanValue.code, 2); assert.match(booleanValue.stderr, /does not accept a value/);
  const missingValue = await run(["analyze", "--format", "--json"]);
  assert.equal(missingValue.code, 2); assert.match(missingValue.stderr, /requires a value/);
  const invalidFormat = await run(["rules", "--format=xml"]);
  assert.equal(invalidFormat.code, 2); assert.match(invalidFormat.stderr, /must be one of/);
  const tooMany = await run(["analyze", ".", "."]);
  assert.equal(tooMany.code, 2); assert.match(tooMany.stderr, /at most one path/);
  const invalidScore = await run(["analyze", "--min-score", "101"]);
  assert.equal(invalidScore.code, 2); assert.match(invalidScore.stderr, /between 0 and 100/);
});

test("covers analyze human/save, clean check and static comparison gating", async () => {
  const clean = await project();
  const risky = await project('import fs from "node:fs"; fs.statSync(".");');
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-analysis-cli-"));
  const baseline = path.join(directory, "baseline.json");

  const human = await run(["analyze", clean, "--save", baseline, "--no-color"]);
  assert.equal(human.code, 0, human.stderr); assert.match(human.stdout, /Velocity performance risk report/);
  assert.equal(JSON.parse(await readFile(baseline, "utf8")).schemaVersion, 1);
  const check = await run(["check", clean, "--format", "json"]);
  assert.equal(check.code, 0, check.stderr);

  const same = await run(["compare", baseline, clean]);
  assert.equal(same.code, 0, same.stderr); assert.match(same.stdout, /Velocity analysis comparison/);
  const gated = await run(["compare", baseline, risky, "--json", "--max-score-drop", "0"]);
  assert.equal(gated.code, 1, gated.stderr); assert.equal(JSON.parse(gated.stdout).kind, "analysis-comparison");
  assert.match((await run(["compare", "--help"])).stdout, /baseline\.json/);
  assert.equal((await run(["compare"])).code, 2);
});

test("covers optimize and verify validation plus human verification outcomes", async () => {
  const fixture = path.resolve("test/fixtures/vite-app");
  const mutuallyExclusive = await run(["optimize", fixture, "--apply", "--dry-run"]);
  assert.equal(mutuallyExclusive.code, 2); assert.match(mutuallyExclusive.stderr, /mutually exclusive/);
  const fixWithoutApply = await run(["optimize", fixture, "--fix", "one"]);
  assert.equal(fixWithoutApply.code, 2); assert.match(fixWithoutApply.stderr, /only valid with --apply/);
  const tooMany = await run(["optimize", fixture, fixture]);
  assert.equal(tooMany.code, 2);
  const humanPlan = await run(["optimize", fixture]);
  assert.equal(humanPlan.code, 0, humanPlan.stderr); assert.match(humanPlan.stdout, /Velocity optimization dry-run/);

  const directory = await mkdtemp(path.join(tmpdir(), "velocity-verify-branches-"));
  const report = (bytes) => ({ schemaVersion: 1, kind: "build", adapter: { adapter: "vite" }, summary: { initialJavaScript: { rawBytes: bytes, brotliBytes: bytes }, javascript: { rawBytes: bytes }, css: { rawBytes: 0 }, total: { rawBytes: bytes } }, budgetViolations: [] });
  const before = path.join(directory, "before.json"); const after = path.join(directory, "after.json");
  await writeFile(before, JSON.stringify(report(100))); await writeFile(after, JSON.stringify(report(150)));
  const regressed = await run(["verify", fixture, "--before", before, "--after", after, "--margin", "0"]);
  assert.equal(regressed.code, 1, regressed.stderr); assert.match(regressed.stdout, /Velocity verification - regressed/);
  const tooManyVerify = await run(["verify", fixture, fixture]);
  assert.equal(tooManyVerify.code, 2);
});

test("covers benchmark JSON/save/compare branches and boundary validation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-bench-cli-"));
  const baseline = path.join(directory, "baseline.json");
  const command = [process.execPath, "-e", "0"];
  const first = await run(["bench", "--runs", "1", "--warmup", "0", "--save", baseline, "--json", "--", ...command]);
  assert.equal(first.code, 0, first.stderr); assert.equal(JSON.parse(first.stdout).schemaVersion, 1);

  const saved = JSON.parse(await readFile(baseline, "utf8"));
  saved.environment.nodeVersion = "different";
  await writeFile(baseline, JSON.stringify(saved));
  const compared = await run(["bench", "--runs", "1", "--warmup", "0", "--compare", baseline, "--allow-environment-mismatch", "--max-regression", "100000", "--json", "--", ...command]);
  assert.equal(compared.code, 0, compared.stderr); assert.equal(JSON.parse(compared.stdout).kind, "benchmark-comparison");

  const misplaced = await run(["bench", "node", "--", process.execPath, "-e", "0"]);
  assert.equal(misplaced.code, 2); assert.match(misplaced.stderr, /must follow the -- boundary/);
  const missing = await run(["bench", "--runs", "1"]);
  assert.equal(missing.code, 2); assert.match(missing.stderr, /requires -- followed by a command/);
});

test("covers profile JSON/save/non-zero exit and config/rules/init validation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "velocity-cli-misc-"));
  const profileFile = path.join(directory, "profile.json");
  const profile = await run(["profile", "--save", profileFile, "--json", "--", process.execPath, "-e", "process.exitCode=3"]);
  assert.equal(profile.code, 3, profile.stderr); assert.equal(JSON.parse(profile.stdout).exit.code, 3); assert.equal(JSON.parse(await readFile(profileFile, "utf8")).exit.code, 3);
  assert.equal((await run(["profile"])).code, 2);
  assert.equal((await run(["profile", "node", "--", process.execPath, "-e", "0"])).code, 2);
  assert.match((await run(["profile", "--help"])).stdout, /node-command/);

  const config = await run(["config", "--print", directory, "--format", "json"]);
  assert.equal(config.code, 0, config.stderr); assert.equal(JSON.parse(config.stdout).schemaVersion, 1);
  assert.equal((await run(["config"])).code, 2);
  assert.equal((await run(["config", "--print", "--format", "human"])).code, 2);
  assert.equal((await run(["config", "--print", directory, directory])).code, 2);
  assert.match((await run(["config", "--help"])).stdout, /config --print/);

  const rulesHuman = await run(["rules"]); assert.equal(rulesHuman.code, 0); assert.match(rulesHuman.stdout, /async\/no-await-in-loop/);
  const rulesJson = await run(["rules", "--json"]); assert.equal(rulesJson.code, 0); assert.ok(JSON.parse(rulesJson.stdout).rules.length > 0);
  assert.equal((await run(["rules", "extra"])).code, 2);
  assert.match((await run(["rules", "-h"])).stdout, /velocity rules/);
  assert.equal((await run(["init", directory, directory])).code, 2);
  assert.match((await run(["init", "--help"])).stdout, /velocity init/);
});
