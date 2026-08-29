import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { compareLoads, measureLoad } from "../src/load.js";

function report(overrides = {}) {
  const measured = { fcpMs: 1000, lcpMs: 1500, cls: 0.02, tbtMs: 100, speedIndexMs: 1300, ttfbMs: 100, requests: 5, transferBytes: 1000, ...(overrides.measured ?? {}) };
  return { schemaVersion: 1, kind: "load", url: "https://example.test/", device: "mobile", unstable: false, measured, ...overrides };
}

test("measures FCP, LCP, CLS, TBT, Speed Index, TTFB, requests and bytes in Chromium", { timeout: 60_000 }, async (context) => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><style>body{font:20px sans-serif}</style><h1>Velocity load fixture</h1><script>const end=performance.now()+80;while(performance.now()<end){}</script>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  let result;
  try { result = await measureLoad(`http://127.0.0.1:${address.port}`, { device: "desktop", runs: 1, timeoutMs: 10_000 }); }
  catch (error) { if (/No compatible Chrome/.test(error.message)) return context.skip(error.message); throw error; }
  for (const metric of ["fcpMs", "lcpMs", "cls", "tbtMs", "speedIndexMs", "ttfbMs", "requests", "transferBytes"]) assert.equal(typeof result.measured[metric], "number");
  assert.match(result.methodology.tbt, /not INP/);
  assert.ok(result.samples[0].requests >= 1);
  assert.ok(result.samples[0].transferBytes > 0);
  assert.ok(result.recommendations.every((item) => item.measured === false));
});

test("classifies load comparisons across all verification outcomes", () => {
  const baseline = report();
  assert.equal(compareLoads(baseline, report()).classification, "unchanged");
  assert.equal(compareLoads(baseline, report({ measured: { lcpMs: 1200 } })).classification, "improved");
  assert.equal(compareLoads(baseline, report({ measured: { lcpMs: 1800 } })).classification, "regressed");
  assert.equal(compareLoads(baseline, report({ unstable: true })).classification, "inconclusive");
  assert.equal(compareLoads(baseline, report({ measured: { lcpMs: 1450 } }), { marginPercent: 5 }).classification, "inconclusive");
  assert.throws(() => compareLoads({ ...baseline, kind: "build" }, baseline), /schema v1/);
  assert.throws(() => compareLoads(baseline, { ...baseline, url: "https://other.test/" }), /URLs differ/);
  assert.throws(() => compareLoads(baseline, { ...baseline, device: "desktop" }), /profiles differ/);
});

test("validates real-load input options", async () => {
  await assert.rejects(measureLoad("file:///tmp/index.html"), /http and https/);
  await assert.rejects(measureLoad("not a URL"), /Invalid URL/);
  await assert.rejects(measureLoad("https://example.test", { runs: 0 }), /runs/);
  await assert.rejects(measureLoad("https://example.test", { device: "tablet" }), /device/);
  await assert.rejects(measureLoad("https://example.test", { timeoutMs: 10 }), /timeoutMs/);
});
