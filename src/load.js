import { access } from "node:fs/promises";
import os from "node:os";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { packageVersion } from "./package-meta.js";

const chromeCandidates = process.platform === "win32"
  ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

async function findBrowser(explicit) {
  for (const candidate of [explicit, process.env.CHROME_PATH, ...chromeCandidates].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch { /* try the next installation */ }
  }
  throw new Error("No compatible Chrome or Edge executable was found. Set CHROME_PATH to a Chromium-based browser.");
}

function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const standardDeviation = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
  return { median, average, min: sorted[0], max: sorted.at(-1), standardDeviation, coefficientOfVariation: average ? standardDeviation / average : 0, samples: values };
}

function visualDifference(current, final, stride = 16) {
  let difference = 0;
  const length = Math.min(current.data.length, final.data.length);
  for (let index = 0; index < length; index += 4 * stride) {
    difference += Math.abs(current.data[index] - final.data[index]);
    difference += Math.abs(current.data[index + 1] - final.data[index + 1]);
    difference += Math.abs(current.data[index + 2] - final.data[index + 2]);
  }
  return difference;
}

function calculateSpeedIndex(frames) {
  if (frames.length < 2) return 0;
  const decoded = frames.map((frame) => ({ time: frame.time, image: PNG.sync.read(frame.buffer) }));
  const first = decoded[0].image;
  const final = decoded.at(-1).image;
  const baseline = visualDifference(first, final);
  if (!baseline) return 0;
  let speedIndex = 0;
  for (let index = 0; index < decoded.length - 1; index += 1) {
    const remaining = visualDifference(decoded[index].image, final);
    const completeness = Math.max(0, Math.min(1, 1 - remaining / baseline));
    speedIndex += (1 - completeness) * (decoded[index + 1].time - decoded[index].time);
  }
  return speedIndex;
}

function recommendations(metrics) {
  const output = [];
  const add = (condition, id, title, evidence, recommendation) => { if (condition) output.push({ id, title, evidence, recommendation, measured: false }); };
  add(metrics.lcpMs > 2500, "load/lcp", "Largest Contentful Paint is above 2.5 s", `${metrics.lcpMs.toFixed(0)} ms measured`, "Prioritize the LCP resource and remove render-blocking work; verify with another load run.");
  add(metrics.cls > 0.1, "load/cls", "Cumulative Layout Shift is above 0.1", `${metrics.cls.toFixed(3)} measured`, "Reserve dimensions for images, ads, and embedded content.");
  add(metrics.tbtMs > 200, "load/tbt", "Total Blocking Time is above 200 ms", `${metrics.tbtMs.toFixed(0)} ms measured`, "Reduce or defer long main-thread tasks. TBT is a lab metric and is not INP.");
  add(metrics.ttfbMs > 800, "load/ttfb", "Server response is slow", `${metrics.ttfbMs.toFixed(0)} ms TTFB measured`, "Measure server, cache, and network contributions separately.");
  add(metrics.requests > 75, "load/requests", "High request count", `${metrics.requests} requests measured`, "Remove unnecessary requests or load non-critical resources later.");
  add(metrics.transferBytes > 1.5 * 1024 * 1024, "load/bytes", "Large transferred payload", `${(metrics.transferBytes / 1024).toFixed(0)} KiB transferred`, "Inspect the largest scripts, images, and fonts before changing delivery.");
  return output;
}

async function measureRun(url, options, browserPath) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
  const mobile = options.device === "mobile";
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 768 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? "VelocityMobileLab/1.0 Chrome" : undefined });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  if (mobile) {
    await session.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8, connectionType: "cellular4g" });
    await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  let requests = 0;
  let transferBytes = 0;
  session.on("Network.requestWillBeSent", () => { requests += 1; });
  session.on("Network.loadingFinished", (event) => { transferBytes += event.encodedDataLength ?? 0; });
  await page.addInitScript(() => {
    globalThis.__velocityMetrics = { lcp: 0, cls: 0, tbt: 0 };
    new globalThis.PerformanceObserver((list) => { for (const entry of list.getEntries()) globalThis.__velocityMetrics.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new globalThis.PerformanceObserver((list) => { for (const rawEntry of list.getEntries()) { const entry = /** @type {any} */ (rawEntry); if (!entry.hadRecentInput) globalThis.__velocityMetrics.cls += entry.value; } }).observe({ type: "layout-shift", buffered: true });
    new globalThis.PerformanceObserver((list) => { for (const entry of list.getEntries()) globalThis.__velocityMetrics.tbt += Math.max(0, entry.duration - 50); }).observe({ type: "longtask", buffered: true });
  });
  const frames = [];
  const startedAt = Date.now();
  let capturing = true;
  const capture = (async () => {
    while (capturing && frames.length < 100) {
      try { frames.push({ time: Date.now() - startedAt, buffer: await page.screenshot({ type: "png", animations: "disabled" }) }); } catch { /* navigation can replace the frame */ }
      // velocity-ignore-next-line async/no-await-in-loop -- filmstrip sampling must preserve time order
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  })();
  try {
    await page.goto(url, { waitUntil: "load", timeout: options.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(5000, options.timeoutMs) }).catch(() => {});
    await page.waitForTimeout(250);
    capturing = false;
    await capture;
    frames.push({ time: Date.now() - startedAt, buffer: await page.screenshot({ type: "png", animations: "disabled" }) });
    const values = await page.evaluate(() => {
      const navigation = /** @type {any} */ (globalThis.performance.getEntriesByType("navigation")[0]);
      const fcp = globalThis.performance.getEntriesByName("first-contentful-paint")[0];
      return { fcpMs: fcp?.startTime ?? 0, ttfbMs: navigation ? navigation.responseStart - navigation.startTime : 0, ...globalThis.__velocityMetrics };
    });
    return { fcpMs: values.fcpMs, lcpMs: values.lcp, cls: values.cls, tbtMs: values.tbt, speedIndexMs: calculateSpeedIndex(frames), ttfbMs: values.ttfbMs, requests, transferBytes, durationMs: Date.now() - startedAt };
  } finally {
    capturing = false;
    await browser.close();
  }
}

export async function measureLoad(url, options = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("load supports only http and https URLs");
  const runs = options.runs ?? 3;
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error("runs must be an integer between 1 and 10");
  const device = options.device ?? "mobile";
  if (!["mobile", "desktop"].includes(device)) throw new Error("device must be mobile or desktop");
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new Error("timeoutMs must be between 1000 and 120000");
  const browserPath = await findBrowser(options.browserPath);
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    // velocity-ignore-next-line async/no-await-in-loop -- isolated browser runs must not contend with each other
    samples.push(await measureRun(parsed.href, { device, timeoutMs }, browserPath));
  }
  const metrics = {};
  for (const key of ["fcpMs", "lcpMs", "cls", "tbtMs", "speedIndexMs", "ttfbMs", "requests", "transferBytes"]) metrics[key] = statistics(samples.map((sample) => sample[key]));
  const measured = Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value.median]));
  const unstable = ["fcpMs", "lcpMs", "tbtMs", "speedIndexMs"].some((key) => metrics[key].coefficientOfVariation > 0.2);
  return { schemaVersion: 1, kind: "load", velocityVersion: packageVersion, generatedAt: new Date().toISOString(), url: parsed.href, device, runs, timeoutMs, methodology: { browser: browserPath, browserEngine: "Chromium", speedIndex: "visual-progress integral from 200 ms PNG filmstrip samples", tbt: "sum of observed long-task duration above 50 ms; TBT is not INP", mobileThrottling: mobileDescription(device) }, environment: { nodeVersion: process.version, platform: process.platform, release: os.release(), architecture: process.arch }, samples, metrics, measured, unstable, recommendations: recommendations(measured) };
}

function mobileDescription(device) { return device === "mobile" ? { latencyMs: 150, downloadBitsPerSecond: 1_600_000, uploadBitsPerSecond: 750_000, cpuSlowdown: 4 } : null; }
function change(before, after) { return before === 0 ? (after === 0 ? 0 : Infinity) : ((after - before) / before) * 100; }

export function compareLoads(baseline, current, options = {}) {
  if (baseline?.schemaVersion !== 1 || baseline.kind !== "load" || current?.schemaVersion !== 1 || current.kind !== "load") throw new Error("Both reports must be Velocity load schema v1 reports");
  if (baseline.url !== current.url) throw new Error("Load URLs differ and cannot be compared");
  if (baseline.device !== current.device) throw new Error("Load device profiles differ and cannot be compared");
  const marginPercent = options.marginPercent ?? 5;
  const metrics = {};
  for (const key of ["fcpMs", "lcpMs", "cls", "tbtMs", "speedIndexMs", "ttfbMs", "requests", "transferBytes"]) metrics[key] = { before: baseline.measured[key], after: current.measured[key], changePercent: change(baseline.measured[key], current.measured[key]) };
  const core = ["fcpMs", "lcpMs", "tbtMs", "speedIndexMs"];
  const changes = core.map((key) => metrics[key].changePercent);
  let classification = "unchanged";
  if (baseline.unstable || current.unstable) classification = "inconclusive";
  else if (changes.some((value) => value > marginPercent)) classification = "regressed";
  else if (changes.some((value) => value < -marginPercent)) classification = "improved";
  else if (changes.some((value) => Math.abs(value) > marginPercent / 2)) classification = "inconclusive";
  return { schemaVersion: 1, kind: "load-comparison", classification, marginPercent, baseline, current, metrics };
}
