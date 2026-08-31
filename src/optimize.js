import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
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
const imageExtension = /\.(?:png|jpe?g|svg|webp)(?:[?#].*)?$/i;

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

function expressionAttribute(attribute) {
  return attribute?.value?.type === "JSXExpressionContainer" ? attribute.value.expression : null;
}

function pngDimensions(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: "PNG" };
  return null;
}

function jpegDimensions(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), format: "JPEG" };
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
  return width && height ? { width: Math.round(Number(width)), height: Math.round(Number(height)), format: "SVG" } : null;
}

function webpVp8xDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP" || buffer.toString("ascii", 12, 16) !== "VP8X") return null;
  return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1, format: "WebP VP8X" };
}

async function imageDimensions(file) {
  try {
    const buffer = await readFile(file);
    return pngDimensions(buffer) ?? jpegDimensions(buffer) ?? svgDimensions(buffer) ?? webpVp8xDimensions(buffer);
  } catch { return null; }
}

function resolveLiteralImage(root, sourceFile, source) {
  if (!source || /^(?:https?:|data:|\/\/)/.test(source)) return null;
  return source.startsWith("/") ? path.join(root, "public", source.slice(1)) : path.resolve(path.dirname(sourceFile), source.replace(/[?#].*$/, ""));
}

function isImportMetaUrl(node) {
  return node?.type === "MemberExpression" && !node.computed && node.property?.type === "Identifier" && node.property.name === "url" && node.object?.type === "MetaProperty" && node.object.meta?.name === "import" && node.object.property?.name === "meta";
}

function newUrlSource(node) {
  const candidate = node?.type === "MemberExpression" && !node.computed && node.property?.type === "Identifier" && node.property.name === "href" ? node.object : node;
  if (candidate?.type !== "NewExpression" || candidate.callee?.type !== "Identifier" || candidate.callee.name !== "URL") return null;
  const [source, base] = candidate.arguments ?? [];
  return source?.type === "StringLiteral" && isImportMetaUrl(base) ? source.value : null;
}

function imageReference(root, sourceFile, attribute, imageImports) {
  const literal = stringAttribute(attribute);
  if (literal) return { file: resolveLiteralImage(root, sourceFile, literal), display: literal, sourceKind: literal.startsWith("/") ? "public" : "literal" };
  const expression = expressionAttribute(attribute);
  if (expression?.type === "Identifier" && imageImports.has(expression.name)) return { file: imageImports.get(expression.name), display: expression.name, sourceKind: "import" };
  const urlSource = newUrlSource(expression);
  if (urlSource) return { file: path.resolve(path.dirname(sourceFile), urlSource), display: `new URL(${JSON.stringify(urlSource)}, import.meta.url)`, sourceKind: "new-url" };
  return { file: null, display: "dynamic image source", sourceKind: "dynamic" };
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
  const imageImports = new Map();
  const nextImageComponents = new Set();
  walk(ast.program, { enter(node) {
    if (node.type === "ImportDeclaration") {
      state.imports += 1;
      const module = node.source.value;
      if (["moment", "lodash", "three", "chart.js", "monaco-editor"].includes(module)) findings.push({ id: "adapter/heavy-dependency", classification: "recommendation", file: path.relative(root, file).replaceAll("\\", "/"), line: node.loc.start.line, evidence: `Static import from ${module}`, recommendation: "Measure the imported surface and consider a route-level dynamic import or a smaller entry point.", measured: false });
      if (module === "next/image") for (const specifier of node.specifiers ?? []) if (specifier.local?.name) nextImageComponents.add(specifier.local.name);
      if (imageExtension.test(module)) for (const specifier of node.specifiers ?? []) if (specifier.local?.name) imageImports.set(specifier.local.name, path.resolve(path.dirname(file), module.replace(/[?#].*$/, "")));
    }
    if (node.type === "CallExpression" && node.callee.type === "Import") state.dynamicImports += 1;
    if (node.type !== "JSXOpeningElement") return;
    const name = jsxName(node.name);
    const attributes = jsxAttributes(node);
    const isNativeImage = name === "img";
    const isNextImage = nextImageComponents.has(name);
    if (isNativeImage || isNextImage) {
      state.nativeImages += isNativeImage ? 1 : 0;
      state.images.push({ file, source, node, attributes, imageImports, component: isNextImage ? "next/image" : "img" });
      if (isNativeImage && adapter.id === "next") findings.push({ id: "next/native-image", classification: "recommendation", file: path.relative(root, file).replaceAll("\\", "/"), line: node.loc.start.line, evidence: "Native <img> used in a Next.js source file", recommendation: "Review migration to next/image with correct sizing and priority. This is not auto-applied because layout and loader semantics can change.", measured: false });
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
  for (const item of images) {
    const reference = imageReference(root, item.file, item.attributes.get("src"), item.imageImports);
    // velocity-ignore-next-line async/no-await-in-loop -- image inspection stays ordered so optimization IDs and evidence remain deterministic
    const dimensions = reference.file ? await imageDimensions(reference.file) : null;
    const additions = [];
    if (dimensions && !item.attributes.has("width")) additions.push(` width={${dimensions.width}}`);
    if (dimensions && !item.attributes.has("height")) additions.push(` height={${dimensions.height}}`);
    if (additions.length) {
      optimizations.push(optimization({
        root, file: item.file, source: item.source, node: item.node,
        classification: "review-required",
        action: "size-image",
        title: "Review intrinsic image dimensions",
        evidence: `${reference.display} resolves to ${dimensions.format} ${dimensions.width}×${dimensions.height}; JSX omits ${additions.map((value) => value.trim().split(/[={]/)[0]).join(", ")}`,
        impact: "Can reserve layout space and reduce avoidable layout shift when these intrinsic dimensions match the intended rendered aspect ratio.",
        risk: "Review required: CSS, responsive sizing, next/image semantics, or transformed assets can make direct intrinsic dimensions inappropriate.",
        insertion: additions.join("")
      }));
    }
    if (!item.attributes.has("loading") && item.component === "img") {
      findings.push({
        id: "image/review-loading-policy",
        classification: "recommendation",
        file: path.relative(root, item.file).replaceAll("\\", "/"),
        line: item.node.loc?.start.line ?? null,
        evidence: `${reference.display} has no explicit loading policy. JSX source order is not evidence that it is outside the initial viewport.`,
        recommendation: "Confirm viewport position with a real load measurement before adding loading=\"lazy\". Velocity never infers lazy-loading safety from JSX source order.",
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
    for (const artifact of build.artifacts.filter((item) => item.category === "javascript" && item.rawBytes > 250 * 1024)) findings.push({ id: "bundle/large-chunk", classification: "recommendation", file: artifact.file, line: null, evidence: `${(artifact.rawBytes / 1024).toFixed(1)} KiB raw${Number.isFinite(artifact.brotliBytes) ? ` / ${(artifact.brotliBytes / 1024).toFixed(1)} KiB Brotli` : ""}`, recommendation: "Inspect the chunk's import graph and split only at a meaningful route or feature boundary.", measured: true });
  }
  return { schemaVersion: 1, kind: "optimization-plan", mode: "dry-run", generatedAt: new Date().toISOString(), target: root, framework: adapter.name, adapter: adapterCapabilities(adapter), evidence: { sourceFiles: discovery.files.length, imports: state.imports, dynamicImports: state.dynamicImports, nativeImages: state.nativeImages, build, buildError }, findings, optimizations };
}

async function atomicWrite(file, contents, mode) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, mode === undefined ? undefined : { mode: mode & 0o7777 });
  await rename(temporary, file);
  if (mode !== undefined) await chmod(file, mode & 0o7777);
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

async function writeRecoveryArtifact(root, runId, entry, desired, actualHash, expectedHash) {
  const target = path.join(root, ".velocity", "recovery", runId, `${entry.file}.recovery`);
  await mkdir(path.dirname(target), { recursive: true });
  await atomicWrite(target, desired, entry.mode);
  return { file: entry.file, recovery: path.relative(root, target).replaceAll("\\", "/"), expectedHash, actualHash, originalHash: entry.hash };
}

async function restoreSnapshot(root, snapshot, retained = [], expectedHashes = new Map()) {
  const retainedByFile = new Map();
  for (const optimization of retained) if (optimization.patch) {
    const list = retainedByFile.get(optimization.patch.file) ?? []; list.push(optimization.patch); retainedByFile.set(optimization.patch.file, list);
  }
  const restored = [];
  const conflicts = [];
  for (const entry of snapshot.files) {
    const original = Buffer.from(entry.contentsBase64, "base64").toString("utf8");
    const desired = applyTextPatches(original, retainedByFile.get(entry.file) ?? []);
    const file = path.join(root, entry.file);
    const expectedHash = expectedHashes.get(entry.file) ?? entry.hash;
    let current;
    try { current = await readFile(file); } catch { current = null; }
    const actualHash = current ? hash(current) : null;
    if (actualHash !== expectedHash) {
      // velocity-ignore-next-line async/no-await-in-loop -- conflicting user edits are preserved and recovery output is written beside the run metadata
      conflicts.push(await writeRecoveryArtifact(root, snapshot.runId, entry, desired, actualHash, expectedHash));
      continue;
    }
    // velocity-ignore-next-line async/no-await-in-loop -- rollback writes only verified files captured in this run's snapshot
    await atomicWrite(file, desired, entry.mode);
    restored.push(entry.file);
  }
  return { restored, conflicts, recoveryArtifacts: conflicts.map((item) => item.recovery) };
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
  const preferred = comparison.metrics.initialJavaScriptBrotli;
  const metric = Number.isFinite(preferred?.before) && Number.isFinite(preferred?.after) ? preferred : comparison.metrics.totalRaw;
  if (!Number.isFinite(metric?.changePercent)) return { classification: "inconclusive", metric, comparison, reason: "The selected build metric is unavailable." };
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
  const run = { schemaVersion: 1, kind: "optimization-run", id: runId, target: root, createdAt: new Date().toISOString(), selected, snapshot: path.relative(root, path.join(root, ".velocity", "snapshots", runId, "manifest.json")).replaceAll("\\", "/"), before: beforeValidation.build, after: null, validation: null, rolledBack: [], rollbackConflicts: [], recoveryArtifacts: [], verification: null };
  const expectedHashes = new Map();
  let validation;
  try {
    for (const [relative, patches] of byFile) {
      const file = path.join(root, relative);
      // velocity-ignore-next-line async/no-await-in-loop -- authorized files are written one at a time for precise rollback
      const source = await readFile(file, "utf8");
      const snapshotEntry = snapshot.files.find((entry) => entry.file === relative);
      if (hash(source) !== snapshotEntry.hash) throw new Error(`File changed after snapshot: ${relative}`);
      const updated = applyTextPatches(source, patches);
      // velocity-ignore-next-line async/no-await-in-loop -- each atomic write is individually restorable from this run's snapshot
      await atomicWrite(file, updated, snapshotEntry.mode);
      expectedHashes.set(relative, hash(updated));
    }
    validation = await validateProject(root, adapter);
    run.after = validation.build;
    run.validation = validation;
  } catch (error) {
    const rollback = await restoreSnapshot(root, snapshot, [], expectedHashes);
    run.rolledBack = rollback.conflicts.length ? [] : selected.map((item) => item.id);
    run.rollbackConflicts = rollback.conflicts;
    run.recoveryArtifacts = rollback.recoveryArtifacts;
    run.verification = { classification: "failed", reason: rollback.conflicts.length ? `Applying authorized patches failed and concurrent edits were detected. User changes were preserved; recovery artifacts were created: ${error.message}` : `Applying authorized patches failed; all Velocity changes were restored: ${error.message}` };
    await writeRun(root, run);
    return run;
  }
  if (!validation.passed) {
    const rollback = await restoreSnapshot(root, snapshot, [], expectedHashes);
    run.rolledBack = rollback.conflicts.length ? [] : selected.map((item) => item.id);
    run.rollbackConflicts = rollback.conflicts;
    run.recoveryArtifacts = rollback.recoveryArtifacts;
    run.verification = { classification: "failed", reason: rollback.conflicts.length ? "Project validation failed and concurrent edits prevented automatic rollback. User changes were preserved; use the recovery artifacts for manual restoration." : "Project validation failed; all Velocity changes were restored." };
    await writeRun(root, run);
    return run;
  }
  run.verification = classifyBuild(beforeValidation.build, validation.build, options.marginPercent ?? 2);
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
    if (before.kind === "load" && after.kind === "load") return { schemaVersion: 1, kind: "verification", ...compareLoads(before, after, { marginPercent: options.marginPercent ?? 5, allowEnvironmentMismatch: options.allowEnvironmentMismatch }) };
    return { schemaVersion: 1, kind: "verification", classification: "failed", reason: "Report kinds are incompatible." };
  }
  const run = await latestRun(root);
  return { schemaVersion: 1, kind: "verification", runId: run.id, selected: run.selected.map((item) => ({ id: item.id, classification: item.classification })), rolledBack: run.rolledBack, rollbackConflicts: run.rollbackConflicts ?? [], recoveryArtifacts: run.recoveryArtifacts ?? [], validation: run.validation, ...run.verification };
}
