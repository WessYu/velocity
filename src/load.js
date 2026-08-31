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

const measurementProtocol = "velocity-load-v2";
const metricKeys = ["fcpMs", "lcpMs", "cls", "tbtMs", "visualProgressIndexMs", "ttfbMs", "requests", "transferBytes"];

async function findBrowser(explicit) {
  for (const candidate of [explicit, process.env.CHROME_PATH, ...chromeCandidates].filter(Boolean)) {
    // velocity-ignore-next-line async/no-await-in-loop -- browser discovery preserves explicit and platform installation priority
    try { await access(candidate); return candidate; } catch { /* try the next installation */ }
  }
  throw new Error("No compatible Chrome or Edge executable was found. Set CHROME_PATH to a Chromium-based browser.");
}

function statistics(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return { median: null, average: null, min: null, max: null, standardDeviation: null, coefficientOfVariation: null, samples: values };
  const sorted = [...numeric].sort((a, b) => a - b);
  const average = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const standardDeviation = Math.sqrt(numeric.reduce((sum, value) => sum + (value - average) ** 2, 0) / numeric.length);
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

function calculateVisualProgressIndex(frames) {
  if (frames.length < 2) return null;
  const decoded = frames.map((frame) => ({ time: frame.time, image: PNG.sync.read(frame.buffer) }));
  const first = decoded[0].image;
  const final = decoded.at(-1).image;
  const baseline = visualDifference(first, final);
  if (!baseline) return 0;
  let indexMs = 0;
  for (let index = 0; index < decoded.length - 1; index += 1) {
    const remaining = visualDifference(decoded[index].image, final);
    const completeness = Math.max(0, Math.min(1, 1 - remaining / baseline));
    indexMs += (1 - completeness) * (decoded[index + 1].time - decoded[index].time);
  }
  return indexMs;
}

function viewportFor(device) { return device === "mobile" ? { width: 390, height: 844 } : { width: 1365, height: 768 }; }
function throttlingFor(device) { return device === "mobile" ? { latencyMs: 150, downloadBitsPerSecond: 1_600_000, uploadBitsPerSecond: 750_000, cpuSlowdown: 4 } : null; }
function chromiumMajor(version) { return Number.parseInt(String(version).split(".")[0], 10) || null; }
function mobileUserAgent(version) { return `Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`; }

function recommendations(metrics) {
  const output = [];
  const add = (condition, id, title, evidence, recommendation) => { if (condition) output.push({ id, title, evidence, recommendation, measured: false }); };
  add(Number.isFinite(metrics.lcpMs) && metrics.lcpMs > 2500, "load/lcp", "Largest Contentful Paint is above 2.5 s", `${metrics.lcpMs.toFixed(0)} ms measured`, "Prioritize the LCP resource and remove render-blocking work; verify with another load run.");
  add(Number.isFinite(metrics.cls) && metrics.cls > 0.1, "load/cls", "Cumulative Layout Shift is above 0.1", `${metrics.cls.toFixed(3)} measured`, "Reserve dimensions for images, ads, and embedded content.");
  add(Number.isFinite(metrics.tbtMs) && metrics.tbtMs > 200, "load/tbt", "Total Blocking Time is above 200 ms", `${metrics.tbtMs.toFixed(0)} ms measured`, "Reduce or defer long main-thread tasks. TBT is a lab metric and is not INP.");
  add(Number.isFinite(metrics.ttfbMs) && metrics.ttfbMs > 800, "load/ttfb", "Server response is slow", `${metrics.ttfbMs.toFixed(0)} ms TTFB measured`, "Measure server, cache, and network contributions separately.");
  add(Number.isFinite(metrics.requests) && metrics.requests > 75, "load/requests", "High request count", `${metrics.requests} requests measured`, "Remove unnecessary requests or load non-critical resources later.");
  add(Number.isFinite(metrics.transferBytes) && metrics.transferBytes > 1.5 * 1024 * 1024, "load/bytes", "Large transferred payload", `${(metrics.transferBytes / 1024).toFixed(0)} KiB transferred`, "Inspect the largest scripts, images, and fonts before changing delivery.");
  return output;
}

async function configurePage(browser, options) {
  const mobile = options.device === "mobile";
  const browserVersion = browser.version();
  const context = await browser.newContext({
    viewport: viewportFor(options.device),
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    ignoreHTTPSErrors: Boolean(options.ignoreHTTPSErrors),
    userAgent: mobile ? mobileUserAgent(browserVersion) : undefined
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  if (mobile) {
    const throttling = throttlingFor(options.device);
    await session.send("Network.emulateNetworkConditions", { offline: false, latency: throttling.latencyMs, downloadThroughput: throttling.downloadBitsPerSecond / 8, uploadThroughput: throttling.uploadBitsPerSecond / 8, connectionType: "cellular4g" });
    await session.send("Emulation.setCPUThrottlingRate", { rate: throttling.cpuSlowdown });
  }
  return { context, page, session, browserVersion };
}

async function measureMetrics(url, options, browserPath) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
  const { context, page, session, browserVersion } = await configurePage(browser, options);
  let requests = 0;
  let transferBytes = 0;
  session.on("Network.requestWillBeSent", () => { requests += 1; });
  session.on("Network.loadingFinished", (event) => { transferBytes += event.encodedDataLength ?? 0; });
  await page.addInitScript(() => {
    globalThis.__velocityMetrics = { lcp: null, cls: 0, tbt: 0, lcpSupported: false, clsSupported: false, longTaskSupported: false };
    try {
      new globalThis.PerformanceObserver((list) => { for (const entry of list.getEntries()) globalThis.__velocityMetrics.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      globalThis.__velocityMetrics.lcpSupported = true;
    } catch { /* unsupported metric remains null */ }
    try {
      new globalThis.PerformanceObserver((list) => { for (const rawEntry of list.getEntries()) { const entry = /** @type {any} */ (rawEntry); if (!entry.hadRecentInput) globalThis.__velocityMetrics.cls += entry.value; } }).observe({ type: "layout-shift", buffered: true });
      globalThis.__velocityMetrics.clsSupported = true;
    } catch { /* unsupported metric remains null */ }
    try {
      new globalThis.PerformanceObserver((list) => { for (const entry of list.getEntries()) globalThis.__velocityMetrics.tbt += Math.max(0, entry.duration - 50); }).observe({ type: "longtask", buffered: true });
      globalThis.__velocityMetrics.longTaskSupported = true;
    } catch { /* unsupported metric remains null */ }
  });
  const startedAt = Date.now();
  try {
    await page.goto(url, { waitUntil: "load", timeout: options.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(5000, options.timeoutMs) }).catch(() => {});
    await page.waitForTimeout(250);
    const values = await page.evaluate(() => {
      const navigation = /** @type {any} */ (globalThis.performance.getEntriesByType("navigation")[0]);
      const fcp = globalThis.performance.getEntriesByName("first-contentful-paint")[0];
      const metrics = globalThis.__velocityMetrics;
      return {
        fcpMs: fcp?.startTime ?? null,
        lcpMs: metrics.lcpSupported ? metrics.lcp : null,
        cls: metrics.clsSupported ? metrics.cls : null,
        tbtMs: metrics.longTaskSupported ? metrics.tbt : null,
        ttfbMs: navigation ? navigation.responseStart - navigation.startTime : null,
        userAgent: globalThis.navigator.userAgent
      };
    });
    return { ...values, visualProgressIndexMs: null, requests, transferBytes, durationMs: Date.now() - startedAt, browserVersion };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function measureVisualProgress(url, options, browserPath) {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] });
  const { context, page } = await configurePage(browser, options);
  const frames = [];
  const startedAt = Date.now();
  let capturing = true;
  const capture = (async () => {
    while (capturing && frames.length < 100) {
      // velocity-ignore-next-line async/no-await-in-loop -- ordered filmstrip samples define the visual-progress approximation
      try { frames.push({ time: Date.now() - startedAt, buffer: await page.screenshot({ type: "png", animations: "disabled" }) }); } catch { /* navigation may replace the frame */ }
      // velocity-ignore-next-line async/no-await-in-loop -- preserve sample order and interval
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
    return calculateVisualProgressIndex(frames);
  } finally {
    capturing = false;
    await context.close();
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
    // velocity-ignore-next-line async/no-await-in-loop -- isolated browser runs must not contend with one another
    const sample = await measureMetrics(parsed.href, { device, timeoutMs, ignoreHTTPSErrors: options.ignoreHTTPSErrors }, browserPath);
    if (options.visual !== false) {
      // velocity-ignore-next-line async/no-await-in-loop -- visual progress is intentionally collected in a separate navigation
      sample.visualProgressIndexMs = await measureVisualProgress(parsed.href, { device, timeoutMs, ignoreHTTPSErrors: options.ignoreHTTPSErrors }, browserPath);
    }
    samples.push(sample);
  }
  const metrics = {};
  for (const key of metricKeys) metrics[key] = statistics(samples.map((sample) => sample[key]));
  const measured = Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value.median]));
  const unstable = ["fcpMs", "lcpMs", "tbtMs", "visualProgressIndexMs"].some((key) => Number.isFinite(metrics[key].coefficientOfVariation) && metrics[key].coefficientOfVariation > 0.2);
  const browserVersion = samples[0]?.browserVersion ?? null;
  const userAgent = samples[0]?.userAgent ?? null;
  const methodology = {
    protocol: measurementProtocol,
    browser: "Chromium",
    browserVersion,
    browserMajorVersion: chromiumMajor(browserVersion),
    userAgent,
    viewport: viewportFor(device),
    throttling: throttlingFor(device),
    visualProgressIndex: options.visual === false ? null : "Velocity visual-progress integral from 200 ms PNG filmstrip samples; approximation, not Lighthouse Speed Index; collected in a separate navigation",
    tbt: "sum of observed long-task duration above 50 ms; TBT is a lab metric and is not INP",
    ignoreHTTPSErrors: Boolean(options.ignoreHTTPSErrors)
  };
  return {
    schemaVersion: 1,
    kind: "load",
    velocityVersion: packageVersion,
    generatedAt: new Date().toISOString(),
    url: parsed.href,
    device,
    runs,
    timeoutMs,
    methodology,
    environment: { nodeVersion: process.version, platform: process.platform, release: os.release(), architecture: process.arch },
    samples,
    metrics,
    measured,
    unstable,
    recommendations: recommendations(measured)
  };
}

function change(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return before === 0 ? (after === 0 ? 0 : Infinity) : ((after - before) / before) * 100;
}

function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function environmentDifferences(baseline, current) {
  const differences = [];
  const compare = (name, left, right) => { if (!same(left, right)) differences.push({ field: name, baseline: left ?? null, current: right ?? null }); };
  compare("device", baseline.device, current.device);
  compare("browser", baseline.methodology?.browser, current.methodology?.browser);
  compare("browserMajorVersion", baseline.methodology?.browserMajorVersion, current.methodology?.browserMajorVersion);
  compare("viewport", baseline.methodology?.viewport, current.methodology?.viewport);
  compare("throttling", baseline.methodology?.throttling, current.methodology?.throttling);
  compare("platform", baseline.environment?.platform, current.environment?.platform);
  compare("architecture", baseline.environment?.architecture, current.environment?.architecture);
  return differences;
}

export function compareLoads(baseline, current, options = {}) {
  if (baseline?.schemaVersion !== 1 || baseline.kind !== "load" || current?.schemaVersion !== 1 || current.kind !== "load") throw new Error("Both reports must be Velocity load schema v1 reports");
  if (baseline.url !== current.url) throw new Error("Load URLs differ and cannot be compared");
  if (baseline.methodology?.protocol !== measurementProtocol || current.methodology?.protocol !== measurementProtocol) throw new Error("Load methodologies differ or are unsupported; create a new baseline with this Velocity version");
  if (!same(baseline.methodology?.visualProgressIndex, current.methodology?.visualProgressIndex) || !same(baseline.methodology?.tbt, current.methodology?.tbt)) throw new Error("Load methodologies differ and cannot be compared");
  const mismatches = environmentDifferences(baseline, current);
  if (mismatches.length && !options.allowEnvironmentMismatch) throw new Error(`Load environments differ (${mismatches.map((item) => item.field).join(", ")}); pass --allow-environment-mismatch to compare as inconclusive`);
  const marginPercent = options.marginPercent ?? 5;
  const metrics = {};
  for (const key of metricKeys) metrics[key] = { before: baseline.measured[key] ?? null, after: current.measured[key] ?? null, changePercent: change(baseline.measured[key], current.measured[key]) };
  const core = ["fcpMs", "lcpMs", "tbtMs", "visualProgressIndexMs"];
  const changes = core.map((key) => metrics[key].changePercent).filter((value) => value !== null);
  let classification = "unchanged";
  if (mismatches.length || baseline.unstable || current.unstable || !changes.length) classification = "inconclusive";
  else if (changes.some((value) => value > marginPercent)) classification = "regressed";
  else if (changes.some((value) => value < -marginPercent)) classification = "improved";
  else if (changes.some((value) => Math.abs(value) > marginPercent / 2)) classification = "inconclusive";
  return { schemaVersion: 1, kind: "load-comparison", classification, marginPercent, environmentMismatches: mismatches, baseline, current, metrics };
}
