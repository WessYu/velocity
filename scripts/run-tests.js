import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = path.join(projectRoot, "test");
const testFiles = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => path.join(testDirectory, entry.name))
  .sort();

if (testFiles.length === 0) {
  console.error("No Velocity test files were found.");
  process.exitCode = 1;
} else {
  // velocity-ignore-next-line node/no-sync-process -- test harness intentionally waits for the isolated suite to finish
  const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...testFiles], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
}
