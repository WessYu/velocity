import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";

const cli = path.resolve("bin/velocity.js");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
    child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("load validates arguments before browser discovery", async () => {
  const missing = await run(["load"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /requires exactly one URL/);

  const extra = await run(["load", "https://example.test", "https://other.test"]);
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /requires exactly one URL/);

  const invalidRuns = await run(["load", "https://example.test", "--runs", "0"]);
  assert.equal(invalidRuns.code, 2);
  assert.match(invalidRuns.stderr, /--runs must/);

  const invalidTimeout = await run(["load", "https://example.test", "--timeout", "999"]);
  assert.equal(invalidTimeout.code, 2);
  assert.match(invalidTimeout.stderr, /--timeout must/);
});

test("load passes semantic validation errors through the CLI", async () => {
  const invalidUrl = await run(["load", "not-a-url", "--runs", "1"]);
  assert.equal(invalidUrl.code, 2);
  assert.match(invalidUrl.stderr, /Invalid URL/);

  const invalidProtocol = await run(["load", "file:///tmp/index.html", "--runs", "1"]);
  assert.equal(invalidProtocol.code, 2);
  assert.match(invalidProtocol.stderr, /only http and https/);

  const invalidDevice = await run(["load", "https://example.test", "--device", "tablet", "--runs", "1"]);
  assert.equal(invalidDevice.code, 2);
  assert.match(invalidDevice.stderr, /device must be mobile or desktop/);
});

test("load short help alias remains side-effect free", async () => {
  const result = await run(["load", "-h"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /velocity load/);
});
