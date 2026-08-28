import test from "node:test";
import assert from "node:assert/strict";
import { profileNodeProcess } from "../src/profile.js";

test("profiles a Node.js process without changing its exit behavior", async () => {
  const result = await profileNodeProcess(process.execPath, ["-e", "setTimeout(() => {}, 35)"], { stdio: "ignore" });
  assert.equal(result.exit.code, 0);
  assert.ok(result.durationMs > 0);
  assert.ok(result.memory.peakRssBytes > 0);
  assert.ok(result.eventLoop.delayP95Ms >= 0);
});
