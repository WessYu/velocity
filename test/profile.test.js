import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { profileNodeProcess } from "../src/profile.js";

test("profiles normal, short, non-zero, child-spawning and spaced-path Node targets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "velocity profile space "));
  const script = path.join(directory, "target script.js");
  await writeFile(script, 'const { spawnSync } = require("node:child_process"); spawnSync(process.execPath, ["-e", "0"]); setTimeout(() => process.exitCode = 3, 20);');
  const result = await profileNodeProcess(process.execPath, [script], { stdio: "ignore", env: { NODE_OPTIONS: "--no-warnings" } });
  assert.equal(result.exit.code, 3); assert.ok(result.durationMs > 0); assert.ok(result.memory.peakRssBytes > 0); assert.equal(result.schemaVersion, 1);
});

test("rejects non-Node targets", async () => {
  await assert.rejects(() => profileNodeProcess("npm", ["--version"], { stdio: "ignore" }), /direct Node\.js executable/);
});

test("cleans up when Node fails before producing a report", async () => {
  await assert.rejects(() => profileNodeProcess(process.execPath, ["--definitely-invalid-node-option"], { stdio: "ignore" }), /did not produce profile data/);
});

test("records a target signal without racing natural process exit", { skip: process.platform === "win32" }, async () => {
  const source = "setTimeout(() => process.kill(process.pid, 'SIGTERM'), 10); setTimeout(() => {}, 1000);";
  const result = await profileNodeProcess(process.execPath, ["-e", source], { stdio: "ignore" });
  assert.deepEqual(result.exit, { code: null, signal: "SIGTERM" });
});

test("does not override application-owned signal handling", { skip: process.platform === "win32" }, async () => {
  const source = "process.once('SIGTERM', () => process.exit(7)); setTimeout(() => process.kill(process.pid, 'SIGTERM'), 20); setTimeout(() => process.exit(9), 1000);";
  const result = await profileNodeProcess(process.execPath, ["-e", source], { stdio: "ignore" });
  assert.deepEqual(result.exit, { code: 7, signal: null });
});
