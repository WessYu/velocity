import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { npmInvocation } from "../src/process.js";
import { fixtureRoot, repositoryRoot, temporaryFixture } from "./helpers.js";

function execute(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => stdout += chunk);
    child.stderr.setEncoding("utf8").on("data", (chunk) => stderr += chunk);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("packaged tarball runs build, load, optimize dry-run/apply, and verify end to end", { timeout: 180_000 }, async (context) => {
  const installation = await mkdtemp(path.join(os.tmpdir(), "velocity-tarball-"));
  const fixture = await temporaryFixture("vite-app");
  const server = http.createServer((_request, response) => response.end("<!doctype html><h1>Packaged Velocity load</h1>"));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); await fixture.cleanup(); await rm(installation, { recursive: true, force: true }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const pack = npmInvocation(["pack", "--pack-destination", installation]);
  const packed = await execute(pack.command, pack.args, repositoryRoot);
  assert.equal(packed.code, 0, packed.stderr);
  const tarball = path.join(installation, (await readdir(installation)).find((file) => file.endsWith(".tgz")));
  await writeFile(path.join(installation, "package.json"), "{\"private\":true}\n");
  const install = npmInvocation(["install", "--ignore-scripts", tarball]);
  const installed = await execute(install.command, install.args, installation);
  assert.equal(installed.code, 0, installed.stderr);
  const cli = path.join(installation, "node_modules", "@wess2001", "velocity", "bin", "velocity.js");
  const invoke = (args) => execute(process.execPath, [cli, ...args], repositoryRoot);

  const built = await invoke(["build", fixtureRoot("vite-app"), "--no-build", "--json"]);
  assert.equal(built.code, 0, built.stderr); assert.equal(JSON.parse(built.stdout).kind, "build");

  const address = server.address();
  const loaded = await invoke(["load", `http://127.0.0.1:${address.port}`, "--device", "desktop", "--runs", "1", "--timeout", "10000", "--json"]);
  if (loaded.code !== 0 && /No compatible Chrome/.test(loaded.stderr)) return context.skip(loaded.stderr);
  assert.equal(loaded.code, 0, loaded.stderr); assert.equal(JSON.parse(loaded.stdout).kind, "load");

  const planned = await invoke(["optimize", fixture.directory, "--json"]);
  assert.equal(planned.code, 0, planned.stderr);
  const fix = JSON.parse(planned.stdout).optimizations.find((item) => item.classification === "safe-fix");
  const applied = await invoke(["optimize", fixture.directory, "--apply", "--fix", fix.id, "--json"]);
  assert.equal(applied.code, 0, applied.stderr); assert.equal(JSON.parse(applied.stdout).kind, "optimization-run");
  const verified = await invoke(["verify", fixture.directory, "--json"]);
  assert.equal(verified.code, 0, verified.stderr); assert.equal(JSON.parse(verified.stdout).kind, "verification");
});
