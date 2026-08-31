import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { compareLoads, measureLoad } from "../src/load.js";

function report(overrides = {}) {
  const measured = { fcpMs: 1000, lcpMs: 1500, cls: 0.02, tbtMs: 100, visualProgressIndexMs: 1300, ttfbMs: 100, requests: 5, transferBytes: 1000, ...(overrides.measured ?? {}) };
  return {
    schemaVersion: 1,
    kind: "load",
    url: "https://example.test/",
    device: "mobile",
    unstable: false,
    methodology: {
      protocol: "velocity-load-v2",
      browser: "Chromium",
      browserVersion: "149.0.7827.0",
      browserMajorVersion: 149,
      userAgent: "Mozilla/5.0 Chrome/149.0.7827.0 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 },
      throttling: { latencyMs: 150, downloadBitsPerSecond: 1_600_000, uploadBitsPerSecond: 750_000, cpuSlowdown: 4 },
      visualProgressIndex: "Velocity visual-progress integral from 200 ms PNG filmstrip samples; approximation, not Lighthouse Speed Index; collected in a separate navigation",
      tbt: "sum of observed long-task duration above 50 ms; TBT is a lab metric and is not INP",
      ignoreHTTPSErrors: false
    },
    environment: { nodeVersion: process.version, platform: process.platform, release: "fixture", architecture: process.arch },
    measured,
    ...overrides
  };
}

test("measures browser metrics and names the visual approximation honestly", { timeout: 60_000 }, async (context) => {
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
  for (const metric of ["fcpMs", "lcpMs", "cls", "tbtMs", "visualProgressIndexMs", "ttfbMs", "requests", "transferBytes"]) assert.ok(result.measured[metric] === null || typeof result.measured[metric] === "number");
  assert.equal("speedIndexMs" in result.measured, false);
  assert.match(result.methodology.visualProgressIndex, /not Lighthouse Speed Index/);
  assert.match(result.methodology.tbt, /not INP/);
  assert.equal(result.methodology.browserMajorVersion, Number(result.methodology.browserVersion.split(".")[0]));
  assert.match(result.methodology.userAgent, new RegExp(`Chrome/${result.methodology.browserVersion.replaceAll(".", "\\.")}`));
  assert.ok(result.samples[0].requests >= 1);
  assert.ok(result.samples[0].transferBytes > 0);
  assert.ok(result.recommendations.every((item) => item.measured === false));
});

test("--no-visual semantics leave the visual metric unavailable instead of zero", { timeout: 30_000 }, async (context) => {
  const server = http.createServer((_request, response) => response.end("<!doctype html><h1>no visual</h1>"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  let result;
  try { result = await measureLoad(`http://127.0.0.1:${address.port}`, { device: "desktop", runs: 1, timeoutMs: 10_000, visual: false }); }
  catch (error) { if (/No compatible Chrome/.test(error.message)) return context.skip(error.message); throw error; }
  assert.equal(result.measured.visualProgressIndexMs, null);
  assert.equal(result.methodology.visualProgressIndex, null);
  assert.equal(result.metrics.visualProgressIndexMs.median, null);
});

test("classifies compatible load comparisons and gates environment overrides", () => {
  const baseline = report();
  assert.equal(compareLoads(baseline, report()).classification, "unchanged");
  assert.equal(compareLoads(baseline, report({ measured: { lcpMs: 1200 } })).classification, "improved");
  assert.equal(compareLoads(baseline, report({ measured: { lcpMs: 1800 } })).classification, "regressed");
  assert.equal(compareLoads(baseline, report({ unstable: true })).classification, "inconclusive");
  assert.equal(compareLoads(baseline, report({ measured: { lcpMs: 1450 } }), { marginPercent: 5 }).classification, "inconclusive");
  assert.equal(compareLoads(baseline, report({ measured: { lcpMs: null, fcpMs: null, tbtMs: null, visualProgressIndexMs: null } })).classification, "inconclusive");
  assert.throws(() => compareLoads({ ...baseline, kind: "build" }, baseline), /schema v1/);
  assert.throws(() => compareLoads(baseline, { ...baseline, url: "https://other.test/" }), /URLs differ/);
  const desktop = report({ device: "desktop", methodology: { ...baseline.methodology, viewport: { width: 1365, height: 768 }, throttling: null } });
  assert.throws(() => compareLoads(baseline, desktop), /allow-environment-mismatch/);
  const overridden = compareLoads(baseline, desktop, { allowEnvironmentMismatch: true });
  assert.equal(overridden.classification, "inconclusive");
  assert.ok(overridden.environmentMismatches.some((item) => item.field === "device"));
  assert.throws(() => compareLoads(baseline, report({ methodology: { ...baseline.methodology, protocol: "old" } })), /methodologies differ/);
});

test("validates real-load input options", async () => {
  await assert.rejects(measureLoad("file:///tmp/index.html"), /http and https/);
  await assert.rejects(measureLoad("not a URL"), /Invalid URL/);
  await assert.rejects(measureLoad("https://example.test", { runs: 0 }), /runs/);
  await assert.rejects(measureLoad("https://example.test", { device: "tablet" }), /device/);
  await assert.rejects(measureLoad("https://example.test", { timeoutMs: 10 }), /timeoutMs/);
});
