import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { packageVersion } from "./package-meta.js";

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index); const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function runOnce(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
    const output = []; let outputBytes = 0;
    const collect = (chunk) => { if (outputBytes < 64 * 1024) { output.push(chunk); outputBytes += chunk.length; } };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const durationMs = performance.now() - startedAt;
      if (code !== 0) {
        const detail = Buffer.concat(output).toString("utf8").trim();
        reject(Object.assign(new Error(`Command exited with ${signal ? `signal ${signal}` : `code ${code}`}${detail ? `\n${detail}` : ""}`), { exit: { code, signal } })); return;
      }
      resolve(durationMs);
    });
  });
}

export async function benchmark(command, args = [], options = {}) {
  if (typeof command !== "string" || !command) throw new TypeError("command must be a non-empty string");
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) throw new TypeError("args must be an array of strings");
  const runs = options.runs ?? 5; const warmup = options.warmup ?? 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new RangeError("runs must be an integer between 1 and 100");
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 20) throw new RangeError("warmup must be an integer between 0 and 20");
  const cwd = path.resolve(options.cwd ?? process.cwd());
  // velocity-ignore-next-line async/no-await-in-loop -- warmups must run sequentially to preserve benchmark order
  for (let index = 0; index < warmup; index += 1) await runOnce(command, args, cwd);
  const samplesMs = [];
  // velocity-ignore-next-line async/no-await-in-loop -- measured samples must not contend with each other
  for (let index = 0; index < runs; index += 1) samplesMs.push(await runOnce(command, args, cwd));
  const averageMs = samplesMs.reduce((sum, value) => sum + value, 0) / runs;
  const variance = samplesMs.reduce((sum, value) => sum + (value - averageMs) ** 2, 0) / runs;
  const standardDeviationMs = Math.sqrt(variance);
  const coefficientOfVariation = averageMs ? standardDeviationMs / averageMs : 0;
  return {
    schemaVersion: 1, velocityVersion: packageVersion, command: [command, ...args], cwd, warmup, runs, samplesMs,
    averageMs, medianMs: percentile(samplesMs, 0.5), minMs: Math.min(...samplesMs), maxMs: Math.max(...samplesMs),
    p50Ms: percentile(samplesMs, 0.5), p95Ms: percentile(samplesMs, 0.95), standardDeviationMs, coefficientOfVariation,
    unstable: coefficientOfVariation > (options.instabilityThreshold ?? 0.15), instabilityThreshold: options.instabilityThreshold ?? 0.15,
    environment: { nodeVersion: process.version, platform: process.platform, release: os.release(), architecture: process.arch, cpu: os.cpus()[0]?.model ?? null },
    timestamp: new Date().toISOString()
  };
}
