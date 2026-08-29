import test from "node:test";
import assert from "node:assert/strict";
import { benchmark } from "../src/benchmark.js";

test("benchmarks without a shell and records complete statistics and environment", async () => {
  const result = await benchmark(process.execPath, ["-e", "process.exit(0)"], { runs: 3, warmup: 0 });
  assert.equal(result.schemaVersion, 1); assert.equal(result.samplesMs.length, 3); assert.equal(result.medianMs, result.p50Ms);
  assert.ok(result.standardDeviationMs >= 0); assert.equal(result.environment.nodeVersion, process.version); assert.ok(result.cwd);
});

test("validates counts and preserves failing command output", async () => {
  await assert.rejects(() => benchmark(process.execPath, [], { runs: 0 }), /runs must be/);
  await assert.rejects(() => benchmark(process.execPath, ["-e", "console.error('diagnostic detail'); process.exit(7)"], { runs: 1, warmup: 0 }), /diagnostic detail/);
});
