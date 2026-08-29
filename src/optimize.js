import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { adapterCapabilities, detectAdapter } from "./adapters.js";
import { walk } from "./ast.js";
import { analyzeBuild, compareBuilds } from "./build.js";
import { loadConfig } from "./config.js";
import { discoverSourceFiles } from "./discovery.js";
import { parseSource } from "./parser.js";
import { npmInvocation, runCommand } from "./process.js";

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function shortId(...parts) { return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 12); }

function jsxName(node) {
  if (node?.type === "JSXIdentifier") return node.name;
  if (node?.type === "JSXMemberExpression") return `${jsxName(node.object)}.${jsxName(node.property)}`;
  return null;
}

function jsxAttributes(node) {
  return new Map((node.attributes ?? []).filter((attribute) => attribute.type === "JSXAttribute").map((attribute) => [attribute.name.name, attribute]));
}

function stringAttribute(attribute) {
  if (attribute?.value?.type === "StringLiteral") return attribute.value.value;
  return null;
}

function pngDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  return null;
}

function jpegDimensions(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function svgDimensions(buffer) {
  const source = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
  if (!/<svg\b/i.test(source)) return null;
  const width = /\bwidth=["'](\d+(?:\.\d+)?)/i.exec(source)?.[1];
  const height = /\bheight=["'](\d+(?:\.\d+)?)/i.exec(source)?.[1];
  return width && height ? { width: Math.round(Number(width)), height: Math.round(Number(height)) } : null;
}

async function imageDimensions(file) {
  try {
    const buffer = await readFile(file);
    return pngDimensions(buffer) ?? jpegDimensions(buffer) ?? svgDimensions(buffer);
  } catch { return null; }
}

function resolveImage(root, sourceFile, source) {
  if (!source || /^(?:https?:|data:|\/\/)/.test(source)) return null;
  return source.startsWith("/") ? path.join(root, "public", source.slice(1)) : path.resolve(path.dirname(sourceFile), source);
}

function applyTextPatches(source, patches) {
  let output = source;
  for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
    if (output.slice(patch.start, patch.end) !== patch.before) throw new Error(`Patch context changed for ${patch.file}:${patch.start}`);
    output = `${output.slice(0, patch.start)}${patch.after}${output.slice(patch.end)}`;
  }
  return output;
}

function optimization({ root, file, source, node, classification, title, evidence, impact, risk, insertion, action }) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const patch = insertion ? { file: relative, start: node.name.end, end: node.name.end, before: "", after: insertion } : null;
  const updated = patch ? applyTextPatches(source, [patch]) : source;
  return {
    id: `${action}-${shortId(relative, node.loc?.start.line ?? 1, insertion ?? title)}`,
    classification,
    title,
    evidence,
    expectedImpact: impact,
    risk,
    files: [relative],
    patch,
    diff: patch ? createTwoFilesPatch(relative, relative, source, updated, "before", "after", { context: 3 }) : null
  };
}

async function inspectSource(root, file, adapter, state) {
  const source = await readFile(file, "utf8");
  const ast = parseSource(source, file);
  const findings = [];
  const optimizations = [];
  walk(ast.program, { enter(node) {
    if (node.type === "ImportDeclaration") {
      state.imports += 1;
      const module = node.source.value;
      if (["moment", "lodash", "three", "chart.js", "monaco-editor"].includes(module)) findings.push({ id: "adapter/heavy-dependency", classification: "recommendation", file: path.relative(root, file).replaceAll("\\", "/"), line: node.loc.start.line, evidence: `Static import from ${module}`, recommendation: "Measure the imported surface and consider a route-level dynamic import or a smaller entry point.", measured: false });
    }
    if (node.type === "CallExpression" && node.callee.type === "Import") state.dynamicImports += 1;
    if (node.type !== "JSXOpeningElement") return;
    const name = jsxName(node.name);
    const attributes = jsxAttributes(node);
    if (name === "img") {
      state.nativeImages += 1;
      state.images.push({ file, source, node, attributes });
      if (adapter.id === "next") findings.push({ id: "next/native-image", classification: "recommendation", file: path.relative(root, file).replaceAll("\\", "/"), line: node.loc.start.line, evidence: "Native <img> used in a Next.js source file", recommendation: "Review migration to next/image with correct sizing and priority. This is not auto-applied because layout and loader semantics can change.", measured: false });
    }
    if (name === "script" && stringAttribute(attributes.get("src")) && !attributes.has("async") && !attributes.has("defer")) {
      optimizations.push(optimization({ root, file, source, node, classification: "review-required", action: "defer-script", title: "Defer a blocking external script", evidence: `<script src="${stringAttribute(attributes.get("src"))}"> has no async/defer`, impact: "May reduce parser blocking and improve FCP/LCP after measurement.", risk: "Execution order can change; review dependencies before authorization.", insertion: " defer" }));
    }
  }});
  return { findings, optimizations };
}

async function imageOptimizations(root, images) {
  const optimizations = [];
  const findings = [];
  for (let index = 0; index < images.length; index += 1) {
    const item = images[index];
    const src = stringAttribute(item.attributes.get("src"));
    const imageFile = resolveImage(root, item.file, src);
    // velocity-ignore-next-line async/no-await-in-loop -- image inspection stays ordered so optimization IDs and evidence remain deterministic
    const dimensions = imageFile ? await imageDimensions(imageFile) : null;
    const additions = [];
    if (dimensions && !item.attributes.has("width")) additions.push(` width={${dimensions.width}}`);
    if (dimensions && !item.attributes.has("height")) additions.push(` height={${dimensions.height}}`);
    if (additions.length) {
      optimizations.push(optimization({
        root, file: item.file, source: item.source, node: item.node,
        classification: "safe-fix",
        action: "size-image",
        title: "Reserve image layout dimensions",
        evidence: `${src} is ${dimensions.width}×${dimensions.height}; JSX omits ${additions.map((value) => value.trim().split(/[={]/)[0]).join(", ")}`,
        impact: "Prevents avoidable layout shift without changing the image resource or its loading priority.",
        risk: "Low; intrinsic dimensions preserve aspect ratio but CSS should still be reviewed.",
        insertion: additions.join("")
      }));
    }
    if (index > 0 && !item.attributes.has("loading")) {
      findings.push({
        id: "image/review-loading-policy",
        classification: "recommendation",
        file: path.relative(root, item.file).replaceAll("\\", "/"),
        line: item.node.loc?.start.line ?? null,
        evidence: `${src ?? "Image"} has no explicit loading policy. Its source order is not evidence that it is below the initial viewport.`,
        recommendation: "Confirm viewport position with a real load measurement before adding loading=\"lazy\". Velocity does not auto-apply lazy loading from JSX source order.",
        measured: false
      });
    }
  }
  return { optimizations, findings };
}

export async function createOptimizationPlan(target = process.cwd(), options = {}) {
  const root = path.resolve(target);
  const adapter = await detectAdapter(root);
  const loaded = await loadConfig(root);
  const discovery = await discoverSourceFiles(root, loaded.config.ignore);
  const state = { imports: 0, dynamicImports: 0, nativeImages: 0, images: [] };
  const findings = [];
  const optimizations = [];
  for (const file of discovery.files) {
    // velocity-ignore-next-line async/no-await-in-loop -- source order makes optimization IDs deterministic
    const result = await inspectSource(root, file, adapter, state);
    findings.push(...result.findings); optimizations.push(...result.optimizations);
  }
  const imageReview = await imageOptimizations(root, state.images);
  optimizations.push(...imageReview.optimizations);
  findings.push(...imageReview.findings);
  if (state.imports >= 8 && state.dynamicImports === 0) findings.push({ id: "adapter/no-dynamic-imports", classification: "recommendation", file: null, line: null, evidence: `${state.imports} static imports and no dynamic imports were found`, recommendation: "Review route or feature boundaries for lazy loading. No patch is generated because component lifecycle and loading UX are semantic decisions.", measured: false });
  let build;
  let buildError = null;
  try { build = await analyzeBuild(root, { runBuild: options.runBuild ?? false, budgets: loaded.config.bundleBudgets }); }
  catch (error) { buildError = error.message; }
  if (build) {
    for (const artifact of build.artifacts.filter((item) => item.category === "javascript" && item.rawBytes > 250 * 1024)) findings.push({ id: "bundle/large-chunk", classification: "recommendation", file: artifact.file, line: null, evidence: `${(artifact.rawBytes / 1024).toFixed(1)} KiB raw / ${(artifact.brotliBytes / 1024).toFixed(1)} KiB Brotli`, recommendation: "Inspect the chunk's import graph and split only at a meaningful route or feature boundary.", measured: true });
  }
  return { schemaVersion: 1, kind: "optimization-plan", mode: "dry-run", generatedAt: new Date().toISOString(), target: root, framework: adapter.name, adapter: adapterCapabilities(adapter), evidence: { sourceFiles: discovery.files.length, imports: state.imports, dynamicImports: state.dynamicImports, nativeImages: state.nativeImages, build, buildError }, findings, optimizations };
}

async function atomicWrite(file, contents) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, file);
}

async function writeRun(root, run) {
  const directory = path.join(root, ".velocity", "runs"); await mkdir(directory, { recursive: true });
  await atomicWrite(path.join(directory, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
}

async function snapshotFiles(root, runId, files) {
  const entries = [];
  for (const relative of files) {
    const file = path.join(root, relative);
    // velocity-ignore-next-line async/no-await-in-loop -- snapshot order is deterministic and limited to authorized files
    const [contents, metadata] = await Promise.all([readFile(file), stat(file)]);
    entries.push({ file: relative, mode: metadata.mode, hash: hash(contents), contentsBase64: contents.toString("base64") });
  }
  const directory = path.join(root, ".velocity", "snapshots", runId); await mkdir(directory, { recursive: true });
  const manifest = { schemaVersion: 1, runId, createdAt: new Date().toISOString(), files: entries };
  await atomicWrite(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function restoreSnapshot(root, snapshot, retained = []) {
  const retainedByFile = new Map();
  for (const optimization of retained) if (optimization.patch) {
    const list = retainedByFile.get(optimization.patch.file) ?? []; list.push(optimization.patch); retainedByFile.set(optimization.patch.file, list);
  }
  for (const entry of snapshot.files) {
    const original = Buffer.from(entry.contentsBase64, "base64").toString("utf8");
    const desired = applyTextPatches(original, retainedByFile.get(entry.file) ?? []);
    // velocity-ignore-next-line async/no-await-in-loop -- rollback writes only files captured in this run's snapshot
    await atomicWrite(path.join(root, entry.file), desired);
  }
}

async function validateProject(root, adapter) {
  const steps = [];
  let build;
  try {
    build = await analyzeBuild(root, { runBuild: Boolean(adapter.manifest.scripts?.build) });
    steps.push({ name: "build", status: "passed", execution: build.buildExecution });
  } catch (error) {
    steps.push({ name: "build", status: "failed", message: error.message, execution: error.execution ?? null });
    return { passed: false, steps, build: null };
  }
  for (const name of ["typecheck", "test"]) {
    if (!adapter.manifest.scripts?.[name]) { steps.push({ name, status: "skipped", reason: `package.json has no ${name} script` }); continue; }
    const args = name === "test" ? ["test"] : ["run", name];
    const npm = npmInvocation(args);
    // velocity-ignore-next-line async/no-await-in-loop -- validation must stop at the first failing project command
    const execution = await runCommand(npm.command, npm.args, { cwd: root });
    steps.push({ name, status: execution.code === 0 ? "passed" : "failed", execution });
    if (execution.code !== 0) return { passed: false, steps, build };
  }
  return { passed: true, steps, build };
}

function classifyBuild(before, after, marginPercent) {
  if (!before || !after) return { classification: "inconclusive", reason: "Comparable before/after build reports are unavailable." };
  const comparison = compareBuilds(before, after);
  const metric = before.summary.initialJavaScript.brotliBytes > 0 ? comparison.metrics.initialJavaScriptBrotli : comparison.metrics.totalRaw;
  if (metric.changePercent < -marginPercent) return { classification: "improved", metric, comparison };
  if (metric.changePercent > marginPercent) return { classification: "regressed", metric, comparison };
  if (metric.changePercent === 0) return { classification: "unchanged", metric, comparison };
  return { classification: "inconclusive", metric, comparison, reason: `Change is within the ${marginPercent}% noise margin.` };
}

export async function applyOptimizations(target = process.cwd(), options = {}) {
  const root = path.resolve(target);
  const requested = options.fixes ?? [];
  if (!requested.length) throw new Error("--apply requires at least one explicit --fix <optimization-id>");
  const adapter = await detectAdapter(root);
  const plan = await createOptimizationPlan(root, { runBuild: false });
  const selected = requested.map((id) => plan.optimizations.find((item) => item.id === id) ?? (() => { throw new Error(`Unknown optimization ID: ${id}`); })());
  if (selected.some((item) => !item.patch)) throw new Error("Every applied optimization must provide a reviewable patch");
  const beforeValidation = await validateProject(root, adapter);
  if (!beforeValidation.passed) {
    const failedStep = beforeValidation.steps.find((step) => step.status === "failed");
    throw new Error(`Project does not pass validation before optimization: ${failedStep && "message" in failedStep ? failedStep.message : "command failed"}`);
  }
  const files = [...new Set(selected.flatMap((item) => item.files))].sort();
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const snapshot = await snapshotFiles(root, runId, files);
  const byFile = new Map();
  for (const item of selected) { const list = byFile.get(item.patch.file) ?? []; list.push(item.patch); byFile.set(item.patch.file, list); }
  const run = { schemaVersion: 1, kind: "optimization-run", id: runId, target: root, createdAt: new Date().toISOString(), selected, snapshot: path.relative(root, path.join(root, ".velocity", "snapshots", runId, "manifest.json")).replaceAll("\\", "/"), before: beforeValidation.build, after: null, validation: null, rolledBack: [], verification: null };
  let validation;
  try {
    for (const [relative, patches] of byFile) {
      const file = path.join(root, relative);
      // velocity-ignore-next-line async/no-await-in-loop -- authorized files are written one at a time for precise rollback
      const source = await readFile(file, "utf8");
      const snapshotEntry = snapshot.files.find((entry) => entry.file === relative);
      if (hash(source) !== snapshotEntry.hash) throw new Error(`File changed after snapshot: ${relative}`);
      // velocity-ignore-next-line async/no-await-in-loop -- each atomic write is individually restorable from this run's snapshot
      await atomicWrite(file, applyTextPatches(source, patches));
    }
    validation = await validateProject(root, adapter);
    run.after = validation.build;
    run.validation = validation;
  } catch (error) {
    await restoreSnapshot(root, snapshot);
    run.rolledBack = selected.map((item) => item.id);
    run.verification = { classification: "failed", reason: `Applying authorized patches failed; all Velocity changes were restored: ${error.message}` };
    await writeRun(root, run);
    return run;
  }
  if (!validation.passed) {
    await restoreSnapshot(root, snapshot);
    run.rolledBack = selected.map((item) => item.id);
    run.verification = { classification: "failed", reason: "Project validation failed; all Velocity changes were restored." };
    await writeRun(root, run);
    return run;
  }
  const measured = selected.filter((item) => item.classification === "measured-fix");
  const verification = classifyBuild(beforeValidation.build, validation.build, options.marginPercent ?? 2);
  run.verification = verification;
  if (measured.length && verification.classification !== "improved") {
    const retained = selected.filter((item) => item.classification !== "measured-fix");
    await restoreSnapshot(root, snapshot, retained);
    run.rolledBack = measured.map((item) => item.id);
    validation = await validateProject(root, adapter);
    run.afterRollbackValidation = validation;
    run.verification.reason = `${run.verification.reason ?? "Measured improvement was not proven."} Measured fixes were restored.`;
  }
  await writeRun(root, run);
  return run;
}

async function latestRun(root) {
  const directory = path.join(root, ".velocity", "runs");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  if (!files.length) throw new Error("No optimization run exists. Run velocity optimize --apply first or pass --before and --after reports.");
  return JSON.parse(await readFile(path.join(directory, files.at(-1)), "utf8"));
}

export async function verifyProject(target = process.cwd(), options = {}) {
  const root = path.resolve(target);
  if (options.before && options.after) {
    const [before, after] = await Promise.all([readFile(path.resolve(options.before), "utf8"), readFile(path.resolve(options.after), "utf8")].map(async (promise) => JSON.parse(await promise)));
    if (before.kind === "build" && after.kind === "build") return { schemaVersion: 1, kind: "verification", ...classifyBuild(before, after, options.marginPercent ?? 2) };
    const { compareLoads } = await import("./load.js");
    if (before.kind === "load" && after.kind === "load") return { schemaVersion: 1, kind: "verification", ...compareLoads(before, after, { marginPercent: options.marginPercent ?? 5 }) };
    return { schemaVersion: 1, kind: "verification", classification: "failed", reason: "Report kinds are incompatible." };
  }
  const run = await latestRun(root);
  return { schemaVersion: 1, kind: "verification", runId: run.id, selected: run.selected.map((item) => ({ id: item.id, classification: item.classification })), rolledBack: run.rolledBack, validation: run.validation, ...run.verification };
}
