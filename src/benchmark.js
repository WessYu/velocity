import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function runOnce(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const child = spawn(command, args, { cwd, stdio: "ignore", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      const durationMs = performance.now() - startedAt;
      if (code !== 0) {
        reject(new Error(`Command exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
        return;
      }
      resolve(durationMs);
    });
  });
}

export async function benchmark(command, args = [], options = {}) {
  const runs = options.runs ?? 5;
  const warmup = options.warmup ?? 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new Error("runs must be an integer between 1 and 100");
  if (!Number.isInteger(warmup) || warmup < 0 || warmup > 20) throw new Error("warmup must be an integer between 0 and 20");

  for (let index = 0; index < warmup; index += 1) await runOnce(command, args, options.cwd);

  const samples = [];
  for (let index = 0; index < runs; index += 1) samples.push(await runOnce(command, args, options.cwd));
  const averageMs = samples.reduce((total, value) => total + value, 0) / samples.length;

  return {
    command: [command, ...args],
    runs,
    warmup,
    samplesMs: samples,
    averageMs,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95)
  };
}
