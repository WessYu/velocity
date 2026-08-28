import test from "node:test";
import assert from "node:assert/strict";
import { benchmark } from "../src/benchmark.js";

test("benchmarks a successful command", async () => {
  const result = await benchmark(process.execPath, ["-e", "process.exit(0)"], { runs: 2, warmup: 0 });
  assert.equal(result.samplesMs.length, 2);
  assert.ok(result.averageMs > 0);
  assert.ok(result.maxMs >= result.minMs);
});

test("rejects an invalid run count", async () => {
  await assert.rejects(() => benchmark(process.execPath, [], { runs: 0 }), /runs must be/);
});
