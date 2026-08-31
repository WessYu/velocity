import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import { readFile, writeFile } from "node:fs/promises";
import { measureLoad } from "../src/load.js";

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}
async function close(server) { await new Promise((resolve) => server.close(resolve)); }
function handler(_request, response) {
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  response.end("<!doctype html><meta charset=utf-8><title>Velocity smoke</title><style>body{font:20px sans-serif}</style><h1>Velocity Chromium smoke</h1><script>const end=performance.now()+30;while(performance.now()<end){}</script>");
}

const httpServer = http.createServer(handler);
const httpPort = await listen(httpServer);
try {
  const report = await measureLoad(`http://127.0.0.1:${httpPort}/`, { device: "desktop", runs: 1, timeoutMs: 15_000, visual: false });
  assert.equal(report.measured.visualProgressIndexMs, null);
  assert.equal(report.methodology.browser, "Chromium");
  assert.equal(report.methodology.browserMajorVersion, Number(report.methodology.browserVersion.split(".")[0]));
  assert.match(report.methodology.userAgent, new RegExp(`Chrome/${report.methodology.browserVersion.replaceAll(".", "\\.")}`));
  assert.ok(report.measured.requests >= 1);
  assert.ok(report.measured.transferBytes > 0);
  await writeFile("load-smoke.json", `${JSON.stringify(report, null, 2)}\n`);
} finally { await close(httpServer); }

if (process.env.VELOCITY_TLS_KEY && process.env.VELOCITY_TLS_CERT) {
  const httpsServer = https.createServer({ key: await readFile(process.env.VELOCITY_TLS_KEY), cert: await readFile(process.env.VELOCITY_TLS_CERT) }, handler);
  const httpsPort = await listen(httpsServer);
  const url = `https://127.0.0.1:${httpsPort}/`;
  try {
    await assert.rejects(measureLoad(url, { device: "desktop", runs: 1, timeoutMs: 15_000, visual: false }), /certificate|cert|SSL|ERR_CERT|authority/i);
    const report = await measureLoad(url, { device: "desktop", runs: 1, timeoutMs: 15_000, visual: false, ignoreHTTPSErrors: true });
    assert.equal(report.methodology.ignoreHTTPSErrors, true);
    assert.ok(report.measured.requests >= 1);
  } finally { await close(httpsServer); }
}

process.stdout.write("Chromium HTTP/HTTPS smoke passed.\n");
