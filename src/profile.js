import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { packageVersion } from "./package-meta.js";

const probePath = fileURLToPath(new URL("./runtime-probe.cjs", import.meta.url));
function quoteNodeOption(value) { return value.includes(" ") ? `"${value.replaceAll('"', '\\"')}"` : value; }
function isNodeCommand(command) {
  const base = path.basename(command).toLowerCase();
  return command === process.execPath || base === "node" || base === "node.exe";
}

export async function profileNodeProcess(command, args = [], options = {}) {
  if (!isNodeCommand(command)) throw new Error("profile requires a direct Node.js executable (node or process.execPath)");
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "velocity-profile-"));
  const prefix = path.join(tempDirectory, "process");
  const existingOptions = options.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? "";
  const env = { ...process.env, ...options.env, NODE_OPTIONS: `${existingOptions} --require ${quoteNodeOption(probePath)}`.trim(), VELOCITY_PROFILE_PREFIX: prefix };
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let child;
  let exit;
  const forwardSigint = () => { if (child && !child.killed) child.kill("SIGINT"); };
  const forwardSigterm = () => { if (child && !child.killed) child.kill("SIGTERM"); };
  process.once("SIGINT", forwardSigint); process.once("SIGTERM", forwardSigterm);
  try {
    exit = await new Promise((resolve, reject) => {
      child = spawn(command, args, { cwd: options.cwd, env, stdio: options.stdio ?? "inherit", shell: false, windowsHide: true });
      child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const targetPid = /** @type {import("node:child_process").ChildProcess} */ (child).pid;
    if (!targetPid) throw new Error("The Node.js target did not start");
    const outputPath = `${prefix}-${targetPid}.json`;
    let result;
    try { result = JSON.parse(await readFile(outputPath, "utf8")); }
    catch { throw new Error("The main target process did not produce profile data. It may have failed before Node.js initialized the profiler."); }
    return { schemaVersion: 1, velocityVersion: packageVersion, command: [command, ...args], cwd: path.resolve(options.cwd ?? process.cwd()), exit, ...result };
  } finally {
    process.removeListener("SIGINT", forwardSigint); process.removeListener("SIGTERM", forwardSigterm);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
