import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { detectAdapter, adapterCapabilities, adapterInsights } from "./adapters.js";
import { packageVersion } from "./package-meta.js";
import { npmInvocation, runCommand } from "./process.js";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);
const DEFAULT_COMPRESSION_CONCURRENCY = 4;
const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const categories = new Map([
  [".js", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"], [".css", "css"],
  [".png", "image"], [".jpg", "image"], [".jpeg", "image"], [".gif", "image"], [".webp", "image"], [".avif", "image"], [".svg", "image"],
  [".woff", "font"], [".woff2", "font"], [".ttf", "font"], [".otf", "font"]
]);
const compressibleExtensions = new Set([".js", ".mjs", ".cjs", ".css", ".html", ".htm", ".json", ".svg", ".xml", ".txt", ".map"]);

async function collectFiles(directory) {
  const files = [];
  const queue = [directory];
  while (queue.length) {
    const current = queue.shift();
    // velocity-ignore-next-line async/no-await-in-loop -- build traversal is bounded and deterministic
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) queue.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function mapLimitOrdered(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      // velocity-ignore-next-line async/no-await-in-loop -- bounded workers intentionally process one artifact at a time
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker()));
  return results;
}

function emptySize() { return { rawBytes: 0, gzipBytes: 0, brotliBytes: 0, files: 0 }; }
function addNullableSize(current, value) { return current === null || value === null ? null : current + value; }
function addSize(target, artifact) {
  target.rawBytes += artifact.rawBytes;
  target.gzipBytes = addNullableSize(target.gzipBytes, artifact.gzipBytes);
  target.brotliBytes = addNullableSize(target.brotliBytes, artifact.brotliBytes);
  target.files += 1;
}

function evaluateBudgets(report, budgets = {}) {
  const checks = [
    ["maxInitialJavaScriptKb", report.summary.initialJavaScript.rawBytes, "Initial JavaScript"],
    ["maxTotalJavaScriptKb", report.summary.javascript.rawBytes, "Total JavaScript"],
    ["maxCssKb", report.summary.css.rawBytes, "CSS"],
    ["maxTotalAssetsKb", report.summary.total.rawBytes, "Total assets"]
  ];
  const violations = [];
  for (const [budget, actual, label] of checks) {
    const limit = budgets[budget];
    if (Number.isFinite(limit) && actual > limit * 1024) violations.push({ budget, label, limitKb: limit, actualKb: actual / 1024, overByKb: actual / 1024 - limit });
  }
  if (Number.isFinite(budgets.maxAssetKb)) {
    const largest = report.artifacts.reduce((current, artifact) => !current || artifact.rawBytes > current.rawBytes ? artifact : current, null);
    if (largest && largest.rawBytes > budgets.maxAssetKb * 1024) violations.push({ budget: "maxAssetKb", label: largest.file, limitKb: budgets.maxAssetKb, actualKb: largest.rawBytes / 1024, overByKb: largest.rawBytes / 1024 - budgets.maxAssetKb });
  }
  if (Number.isFinite(budgets.maxChunkKb)) {
    for (const artifact of report.artifacts.filter((item) => item.category === "javascript" && item.rawBytes > budgets.maxChunkKb * 1024)) violations.push({ budget: "maxChunkKb", label: artifact.file, limitKb: budgets.maxChunkKb, actualKb: artifact.rawBytes / 1024, overByKb: artifact.rawBytes / 1024 - budgets.maxChunkKb });
  }
  return violations;
}

async function measureArtifact(entry, maxArtifactBytes) {
  const extension = path.extname(entry.file).toLowerCase();
  const metadata = await stat(entry.file);
  const base = { file: entry.relative, extension, category: categories.get(extension) ?? "asset", rawBytes: metadata.size, gzipBytes: null, brotliBytes: null, initial: false, compression: "not-applicable" };
  if (!compressibleExtensions.has(extension)) return base;
  if (metadata.size > maxArtifactBytes) return { ...base, compression: "skipped-size-limit" };
  const buffer = await readFile(entry.file);
  const [gzipped, brotlied] = await Promise.all([gzipAsync(buffer), brotliAsync(buffer)]);
  return { ...base, rawBytes: buffer.length, gzipBytes: gzipped.length, brotliBytes: brotlied.length, compression: "measured" };
}

export async function analyzeBuild(target = process.cwd(), options = {}) {
  const root = path.resolve(target);
  const metadata = await stat(root);
  if (!metadata.isDirectory()) throw new Error("build target must be a project directory");
  const concurrency = options.concurrency ?? DEFAULT_COMPRESSION_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("build concurrency must be an integer between 1 and 16");
  const maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  if (!Number.isFinite(maxArtifactBytes) || maxArtifactBytes < 1024) throw new Error("maxArtifactBytes must be at least 1024 bytes");
  const adapter = await detectAdapter(root);
  let buildExecution = null;
  if (options.runBuild !== false && adapter.manifest.scripts?.build) {
    const npm = npmInvocation(["run", "build"]);
    buildExecution = await runCommand(npm.command, npm.args, { cwd: root });
    if (buildExecution.code !== 0) throw Object.assign(new Error(`Build failed with ${buildExecution.signal ? `signal ${buildExecution.signal}` : `code ${buildExecution.code}`}\n${buildExecution.stderr || buildExecution.stdout}`), { execution: buildExecution });
  }
  const outputDirectory = path.resolve(root, options.outputDirectory ?? adapter.outputDirectory);
  let files;
  try { files = (await collectFiles(outputDirectory)).map((file) => ({ file, relative: path.relative(outputDirectory, file).replaceAll("\\", "/") })); }
  catch (error) { throw new Error(`Could not read ${outputDirectory}. Run the project build or pass the correct output directory: ${error.message}`, { cause: error }); }
  if (adapter.id === "next") {
    try {
      const publicDirectory = path.join(root, "public");
      files.push(...(await collectFiles(publicDirectory)).map((file) => ({ file, relative: `public/${path.relative(publicDirectory, file).replaceAll("\\", "/")}` })));
    } catch { /* public is optional */ }
  }
  files.sort((a, b) => a.relative.localeCompare(b.relative));
  const artifacts = await mapLimitOrdered(files, concurrency, (entry) => measureArtifact(entry, maxArtifactBytes));
  const initialFiles = await adapter.initialFiles(root, outputDirectory, artifacts);
  for (const artifact of artifacts) artifact.initial = initialFiles.has(artifact.file);
  const insights = await adapterInsights(adapter, root, outputDirectory, artifacts);
  const summary = { total: emptySize(), javascript: emptySize(), initialJavaScript: emptySize(), css: emptySize(), images: emptySize(), fonts: emptySize(), assets: emptySize() };
  for (const artifact of artifacts) {
    addSize(summary.total, artifact);
    const key = artifact.category === "image" ? "images" : artifact.category === "font" ? "fonts" : artifact.category === "asset" ? "assets" : artifact.category;
    addSize(summary[key], artifact);
    if (artifact.category === "javascript" && artifact.initial) addSize(summary.initialJavaScript, artifact);
  }
  const report = { schemaVersion: 1, kind: "build", velocityVersion: packageVersion, generatedAt: new Date().toISOString(), target: root, framework: adapter.name, adapter: adapterCapabilities(adapter), outputDirectory, buildExecution, artifactMeasurement: { concurrency, maxArtifactBytes, compression: "gzip/Brotli are measured only for known text formats; already-compressed/binary formats are null" }, artifacts, summary, insights, budgets: options.budgets ?? {}, budgetViolations: [] };
  report.budgetViolations = evaluateBudgets(report, report.budgets);
  return report;
}

function percent(before, after) { return before === 0 ? (after === 0 ? 0 : Infinity) : ((after - before) / before) * 100; }
export function compareBuilds(baseline, current) {
  if (baseline?.schemaVersion !== 1 || baseline.kind !== "build" || current?.schemaVersion !== 1 || current.kind !== "build") throw new Error("Both reports must be Velocity build schema v1 reports");
  if (baseline.adapter?.adapter !== current.adapter?.adapter) throw new Error("Build adapters differ and cannot be compared without a new baseline");
  const metrics = {};
  for (const [name, before, after] of [
    ["initialJavaScriptRaw", baseline.summary.initialJavaScript.rawBytes, current.summary.initialJavaScript.rawBytes],
    ["initialJavaScriptBrotli", baseline.summary.initialJavaScript.brotliBytes, current.summary.initialJavaScript.brotliBytes],
    ["totalJavaScriptRaw", baseline.summary.javascript.rawBytes, current.summary.javascript.rawBytes],
    ["cssRaw", baseline.summary.css.rawBytes, current.summary.css.rawBytes],
    ["totalRaw", baseline.summary.total.rawBytes, current.summary.total.rawBytes]
  ]) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) metrics[name] = { before: before ?? null, after: after ?? null, deltaBytes: null, changePercent: null };
    else metrics[name] = { before, after, deltaBytes: after - before, changePercent: percent(before, after) };
  }
  return { schemaVersion: 1, kind: "build-comparison", baseline, current, metrics, budgetViolations: current.budgetViolations };
}
