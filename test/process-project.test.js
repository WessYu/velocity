import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectProject } from "../src/project.js";
import { npmInvocation, runCommand } from "../src/process.js";

async function temporaryProject() {
  const root = await mkdtemp(path.join(tmpdir(), "velocity-project-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("runCommand captures stdout, stderr, environment and exit metadata", async () => {
  const result = await runCommand(process.execPath, ["-e", "console.log(process.env.VELOCITY_TEST); console.error('err'); process.exitCode=4"], {
    env: { VELOCITY_TEST: "visible" }
  });
  assert.equal(result.code, 4);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /visible/);
  assert.match(result.stderr, /err/);
  assert.deepEqual(result.command.slice(0, 2), [process.execPath, "-e"]);
  assert.ok(result.durationMs >= 0);
});

test("runCommand enforces one shared output limit across stdout and stderr", async () => {
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write('abcdef'); process.stderr.write('ghijkl')"], { outputLimitBytes: 5 });
  assert.equal(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr), 5);
  assert.equal(result.stdout, "abcde");
  assert.equal(result.stderr, "");
});

test("npmInvocation uses the direct npm executable on non-Windows platforms", { skip: process.platform === "win32" }, () => {
  assert.deepEqual(npmInvocation(["test", "--", "x"]), { command: "npm", args: ["test", "--", "x"] });
});

test("detectProject falls back cleanly without package metadata", async () => {
  const fixture = await temporaryProject();
  try {
    const result = await detectProject(fixture.root, [path.join(fixture.root, "index.js"), path.join(fixture.root, "types.d.ts")]);
    assert.equal(result.name, path.basename(fixture.root));
    assert.equal(result.moduleType, "commonjs");
    assert.equal(result.language, "JavaScript");
    assert.equal(result.packageManager, null);
    assert.deepEqual(result.frameworks, []);
  } finally { await fixture.cleanup(); }
});

test("detectProject reads framework, module, TypeScript and lockfile metadata", async () => {
  const fixture = await temporaryProject();
  try {
    await writeFile(path.join(fixture.root, "package.json"), JSON.stringify({
      name: "fixture-app",
      type: "module",
      dependencies: { next: "16", react: "19", express: "5" },
      devDependencies: { vite: "7", fastify: "5" }
    }));
    await writeFile(path.join(fixture.root, "package-lock.json"), "{}");
    await writeFile(path.join(fixture.root, "yarn.lock"), "");
    const result = await detectProject(fixture.root, [path.join(fixture.root, "src", "app.tsx"), path.join(fixture.root, "types.d.ts")]);
    assert.equal(result.name, "fixture-app");
    assert.equal(result.moduleType, "module");
    assert.equal(result.language, "TypeScript");
    assert.equal(result.packageManager, "yarn");
    assert.deepEqual(result.frameworks, ["Next.js", "React", "Express", "Fastify"]);
  } finally { await fixture.cleanup(); }
});

test("detectProject tolerates malformed package JSON and honors lockfile priority", async () => {
  const fixture = await temporaryProject();
  try {
    await writeFile(path.join(fixture.root, "package.json"), "{");
    await writeFile(path.join(fixture.root, "bun.lock"), "");
    await writeFile(path.join(fixture.root, "package-lock.json"), "{}");
    const result = await detectProject(fixture.root, [path.join(fixture.root, "index.mts")]);
    assert.equal(result.moduleType, "commonjs");
    assert.equal(result.language, "TypeScript");
    assert.equal(result.packageManager, "bun");
    assert.deepEqual(result.frameworks, []);
  } finally { await fixture.cleanup(); }
});
