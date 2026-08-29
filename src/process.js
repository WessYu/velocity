import { spawn } from "node:child_process";
import path from "node:path";

export function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const limit = options.outputLimitBytes ?? 2 * 1024 * 1024;
    const collect = (target) => (chunk) => {
      if (bytes >= limit) return;
      const remaining = limit - bytes;
      target.push(chunk.subarray(0, remaining));
      bytes += Math.min(chunk.length, remaining);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({
      command: [command, ...args],
      code,
      signal,
      durationMs: Date.now() - startedAt,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8")
    }));
  });
}

export function npmInvocation(args) {
  if (process.platform !== "win32") return { command: "npm", args };
  const cli = process.env.npm_execpath?.endsWith(".js")
    ? process.env.npm_execpath
    : path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return { command: process.execPath, args: [cli, ...args] };
}
