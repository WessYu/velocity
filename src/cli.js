import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeProject, getRuleCatalog } from "./analyzer.js";
import { benchmark } from "./benchmark.js";
import { analyzeBuild, compareBuilds } from "./build.js";
import { compareBenchmarks, compareReports } from "./comparison.js";
import { loadConfig } from "./config.js";
import { packageVersion } from "./package-meta.js";
import { profileNodeProcess } from "./profile.js";
import { formatAnalysisComparison, formatBenchmark, formatBenchmarkComparison, formatBuild, formatBuildComparison, formatLoad, formatLoadComparison, formatOptimizationPlan, formatOptimizationRun, formatProfile, formatReport, formatVerification } from "./reporter.js";
import { toSarif } from "./sarif.js";

const commandSummary = `Velocity — performance risk analysis and regression budgets

Usage: velocity <command> [options]

Commands:
  analyze [path]              Find likely performance risks
  check [path]                Enforce severity and health-score budgets
  build [path]                Build and measure bundles and assets
  load <url>                  Measure a URL in a real browser
  optimize [path]             Plan or apply authorized optimizations
  verify [path]               Verify before/after measurements
  compare <baseline> [path]   Gate new static-analysis regressions
  bench [options] -- <cmd>    Measure a command repeatedly
  profile [options] -- <node> Profile one Node.js process
  config --print [path]       Print the resolved configuration
  rules                       List the built-in rule catalog
  init [path]                 Create velocity.config.json safely

Global options: --help, -h, --version, -v
Run velocity <command> --help for command-specific options.`;

const commandHelp = {
  analyze: "Usage: velocity analyze [path] [--format human|json|sarif] [--save file] [--min-score 70] [--no-color]",
  check: "Usage: velocity check [path] [--format human|json|sarif] [--save file] [--min-score 70] [--no-color]",
  build: "Usage: velocity build [path] [--no-build] [--output-dir dir] [--save file] [--compare file] [--max-regression 0] [--max-initial-js kb] [--max-total-js kb] [--max-css kb] [--max-asset kb] [--max-total-assets kb] [--max-chunk kb] [--format human|json]",
  load: "Usage: velocity load <url> [--device mobile|desktop] [--runs 3] [--timeout 30000] [--browser path] [--no-visual] [--ignore-https-errors] [--save file] [--compare file] [--margin 5] [--allow-environment-mismatch] [--format human|json]",
  optimize: "Usage: velocity optimize [path] [--dry-run] [--apply --fix id ...] [--margin 2] [--save file] [--format human|json]",
  verify: "Usage: velocity verify [path] [--before report.json --after report.json] [--margin 2] [--allow-environment-mismatch] [--format human|json]",
  compare: "Usage: velocity compare <baseline.json> [path] [--max-score-drop 0] [--format human|json] [--no-color]",
  bench: "Usage: velocity bench [--runs 5] [--warmup 1] [--save file] [--compare file] [--max-regression 10] [--allow-environment-mismatch] [--format human|json] -- <command> [...args]",
  profile: "Usage: velocity profile [--save file] [--format human|json] -- <node-command> [...args]",
  config: "Usage: velocity config --print [path] [--format json]",
  rules: "Usage: velocity rules [--format human|json]",
  init: "Usage: velocity init [path]"
};

export class CliError extends Error {
  constructor(message, exitCode = 2) { super(message); this.name = "CliError"; this.exitCode = exitCode; }
}

function splitBoundary(args) {
  const index = args.indexOf("--");
  return index === -1 ? { own: args, child: [] } : { own: args.slice(0, index), child: args.slice(index + 1) };
}

function parseOptions(args, specification) {
  const options = {}; const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("-") || value === "-") { positionals.push(value); continue; }
    const [name, inline] = value.split(/=(.*)/s, 2);
    const kind = specification[name];
    if (!kind) throw new CliError(`Unknown option: ${name}`);
    if (kind === "boolean") { if (inline !== undefined) throw new CliError(`${name} does not accept a value`); options[name] = true; continue; }
    const optionValue = inline ?? args[++index];
    if (optionValue === undefined || optionValue.startsWith("--")) throw new CliError(`${name} requires a value`);
    if (kind === "multiple") options[name] = [...(options[name] ?? []), optionValue];
    else options[name] = optionValue;
  }
  return { options, positionals };
}

function numberOption(value, name, fallback, { integer = false, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) throw new CliError(`${name} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
  return parsed;
}

function outputFormat(options, allowed) {
  const format = options["--json"] ? "json" : (options["--format"] ?? "human");
  if (!allowed.includes(format)) throw new CliError(`--format must be one of: ${allowed.join(", ")}`);
  return format;
}

function print(value, stream = process.stdout) { stream.write(`${value}\n`); }
async function saveJson(file, value) {
  const target = path.resolve(file); await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

function severityFails(report, threshold) {
  if (threshold === "off") return false;
  const rank = { info: 1, warning: 2, error: 3 };
  return report.issues.some((issue) => rank[issue.severity] >= rank[threshold]);
}

const analysisSpec = { "--format": "value", "--json": "boolean", "--save": "value", "--min-score": "value", "--no-color": "boolean", "--help": "boolean", "-h": "boolean" };
async function analyzeCommand(command, args) {
  const { options, positionals } = parseOptions(args, analysisSpec);
  if (options["--help"] || options["-h"]) return print(commandHelp[command]);
  if (positionals.length > 1) throw new CliError(`${command} accepts at most one path`);
  const minScore = numberOption(options["--min-score"], "--min-score", undefined, { min: 0, max: 100 });
  const report = await analyzeProject(positionals[0] ?? process.cwd(), { config: minScore === undefined ? {} : { minScore } });
  const format = outputFormat(options, ["human", "json", "sarif"]);
  const result = format === "sarif" ? toSarif(report) : report;
  if (options["--save"]) await saveJson(options["--save"], result);
  print(format === "human" ? formatReport(report, { color: !options["--no-color"] && process.stdout.isTTY }) : JSON.stringify(result, null, 2));
  if (command === "check" && (report.score < report.config.minScore || severityFails(report, report.config.failOn))) process.exitCode = 1;
}

async function compareCommand(args) {
  const { options, positionals } = parseOptions(args, { "--format": "value", "--json": "boolean", "--max-score-drop": "value", "--no-color": "boolean", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.compare);
  if (!positionals[0] || positionals.length > 2) throw new CliError("compare requires a baseline JSON file and accepts one optional target path");
  const baseline = JSON.parse(await readFile(path.resolve(positionals[0]), "utf8"));
  const comparison = compareReports(baseline, await analyzeProject(positionals[1] ?? process.cwd()));
  const format = outputFormat(options, ["human", "json"]);
  print(format === "json" ? JSON.stringify(comparison, null, 2) : formatAnalysisComparison(comparison));
  const maxDrop = numberOption(options["--max-score-drop"], "--max-score-drop", 0, { min: 0, max: 100 });
  if (comparison.scoreDelta < -maxDrop || comparison.newIssues.some((issue) => issue.severity === "error")) process.exitCode = 1;
}

async function buildCommand(args) {
  const specification = { "--no-build": "boolean", "--output-dir": "value", "--save": "value", "--compare": "value", "--max-regression": "value", "--max-initial-js": "value", "--max-total-js": "value", "--max-css": "value", "--max-asset": "value", "--max-total-assets": "value", "--max-chunk": "value", "--format": "value", "--json": "boolean", "--help": "boolean", "-h": "boolean" };
  const { options, positionals } = parseOptions(args, specification);
  if (options["--help"] || options["-h"]) return print(commandHelp.build);
  if (positionals.length > 1) throw new CliError("build accepts at most one path");
  const target = positionals[0] ?? process.cwd();
  const loaded = await loadConfig(target);
  const budgetFlags = { maxInitialJavaScriptKb: "--max-initial-js", maxTotalJavaScriptKb: "--max-total-js", maxCssKb: "--max-css", maxAssetKb: "--max-asset", maxTotalAssetsKb: "--max-total-assets", maxChunkKb: "--max-chunk" };
  const budgets = { ...loaded.config.bundleBudgets };
  for (const [key, flag] of Object.entries(budgetFlags)) if (options[flag] !== undefined) budgets[key] = numberOption(options[flag], flag, undefined, { min: 0.001 });
  const report = await analyzeBuild(target, { runBuild: !options["--no-build"], outputDirectory: options["--output-dir"], budgets });
  if (options["--save"]) await saveJson(options["--save"], report);
  const format = outputFormat(options, ["human", "json"]);
  if (!options["--compare"]) print(format === "json" ? JSON.stringify(report, null, 2) : formatBuild(report));
  else {
    const baseline = JSON.parse(await readFile(path.resolve(options["--compare"]), "utf8"));
    const comparison = compareBuilds(baseline, report);
    print(format === "json" ? JSON.stringify(comparison, null, 2) : formatBuildComparison(comparison));
    const maxRegression = numberOption(options["--max-regression"], "--max-regression", 0, { min: 0 });
    const metric = comparison.metrics.initialJavaScriptBrotli;
    if (Number.isFinite(metric.changePercent) && metric.changePercent > maxRegression) process.exitCode = 1;
  }
  if (report.budgetViolations.length) process.exitCode = 1;
}

async function loadCommand(args) {
  const { options, positionals } = parseOptions(args, { "--device": "value", "--runs": "value", "--timeout": "value", "--browser": "value", "--no-visual": "boolean", "--ignore-https-errors": "boolean", "--allow-environment-mismatch": "boolean", "--save": "value", "--compare": "value", "--margin": "value", "--format": "value", "--json": "boolean", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.load);
  if (positionals.length !== 1) throw new CliError("load requires exactly one URL");
  const { compareLoads, measureLoad } = await import("./load.js");
  const report = await measureLoad(positionals[0], { device: options["--device"] ?? "mobile", runs: numberOption(options["--runs"], "--runs", 3, { integer: true, min: 1, max: 10 }), timeoutMs: numberOption(options["--timeout"], "--timeout", 30_000, { integer: true, min: 1_000, max: 120_000 }), browserPath: options["--browser"], visual: !options["--no-visual"], ignoreHTTPSErrors: Boolean(options["--ignore-https-errors"]) });
  if (options["--save"]) await saveJson(options["--save"], report);
  const format = outputFormat(options, ["human", "json"]);
  if (!options["--compare"]) return print(format === "json" ? JSON.stringify(report, null, 2) : formatLoad(report));
  const baseline = JSON.parse(await readFile(path.resolve(options["--compare"]), "utf8"));
  const comparison = compareLoads(baseline, report, { marginPercent: numberOption(options["--margin"], "--margin", 5, { min: 0 }), allowEnvironmentMismatch: Boolean(options["--allow-environment-mismatch"]) });
  print(format === "json" ? JSON.stringify(comparison, null, 2) : formatLoadComparison(comparison));
  if (["regressed", "failed"].includes(comparison.classification)) process.exitCode = 1;
}

async function optimizeCommand(args) {
  const { options, positionals } = parseOptions(args, { "--dry-run": "boolean", "--apply": "boolean", "--fix": "multiple", "--margin": "value", "--save": "value", "--format": "value", "--json": "boolean", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.optimize);
  if (positionals.length > 1) throw new CliError("optimize accepts at most one path");
  if (options["--apply"] && options["--dry-run"]) throw new CliError("--apply and --dry-run are mutually exclusive");
  if (!options["--apply"] && options["--fix"]?.length) throw new CliError("--fix is only valid with --apply");
  const { applyOptimizations, createOptimizationPlan } = await import("./optimize.js");
  const target = positionals[0] ?? process.cwd();
  const result = options["--apply"]
    ? await applyOptimizations(target, { fixes: options["--fix"] ?? [], marginPercent: numberOption(options["--margin"], "--margin", 2, { min: 0 }) })
    : await createOptimizationPlan(target, { runBuild: false });
  if (options["--save"]) await saveJson(options["--save"], result);
  const format = outputFormat(options, ["human", "json"]);
  print(format === "json" ? JSON.stringify(result, null, 2) : result.kind === "optimization-plan" ? formatOptimizationPlan(result) : formatOptimizationRun(result));
  if (result.kind === "optimization-run" && result.verification.classification === "failed") process.exitCode = 1;
}

async function verifyCommand(args) {
  const { options, positionals } = parseOptions(args, { "--before": "value", "--after": "value", "--margin": "value", "--allow-environment-mismatch": "boolean", "--format": "value", "--json": "boolean", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.verify);
  if (positionals.length > 1) throw new CliError("verify accepts at most one path");
  if (Boolean(options["--before"]) !== Boolean(options["--after"])) throw new CliError("--before and --after must be provided together");
  const { verifyProject } = await import("./optimize.js");
  const result = await verifyProject(positionals[0] ?? process.cwd(), { before: options["--before"], after: options["--after"], marginPercent: numberOption(options["--margin"], "--margin", 2, { min: 0 }), allowEnvironmentMismatch: Boolean(options["--allow-environment-mismatch"]) });
  const format = outputFormat(options, ["human", "json"]);
  print(format === "json" ? JSON.stringify(result, null, 2) : formatVerification(result));
  if (["regressed", "failed"].includes(result.classification)) process.exitCode = 1;
}

async function benchCommand(args) {
  const { own, child } = splitBoundary(args);
  const { options, positionals } = parseOptions(own, { "--runs": "value", "--warmup": "value", "--save": "value", "--compare": "value", "--max-regression": "value", "--allow-environment-mismatch": "boolean", "--format": "value", "--json": "boolean", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.bench);
  if (positionals.length) throw new CliError("bench command arguments must follow the -- boundary");
  if (!child[0]) throw new CliError("bench requires -- followed by a command");
  const result = await benchmark(child[0], child.slice(1), { runs: numberOption(options["--runs"], "--runs", 5, { integer: true, min: 1, max: 100 }), warmup: numberOption(options["--warmup"], "--warmup", 1, { integer: true, min: 0, max: 20 }), cwd: process.cwd() });
  if (options["--save"]) await saveJson(options["--save"], result);
  const format = outputFormat(options, ["human", "json"]);
  if (!options["--compare"]) return print(format === "json" ? JSON.stringify(result, null, 2) : formatBenchmark(result));
  const baseline = JSON.parse(await readFile(path.resolve(options["--compare"]), "utf8"));
  const comparison = compareBenchmarks(baseline, result, { allowEnvironmentMismatch: Boolean(options["--allow-environment-mismatch"]) });
  print(format === "json" ? JSON.stringify(comparison, null, 2) : formatBenchmarkComparison(comparison));
  const maxRegression = numberOption(options["--max-regression"], "--max-regression", 10, { min: 0 });
  if (comparison.reliable && comparison.averageChangePercent > maxRegression) process.exitCode = 1;
}

async function profileCommand(args) {
  const { own, child } = splitBoundary(args);
  const { options, positionals } = parseOptions(own, { "--save": "value", "--format": "value", "--json": "boolean", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.profile);
  if (positionals.length) throw new CliError("profile command arguments must follow the -- boundary");
  if (!child[0]) throw new CliError("profile requires -- followed by a direct Node.js command");
  const format = outputFormat(options, ["human", "json"]);
  const result = await profileNodeProcess(child[0], child.slice(1), { cwd: process.cwd(), stdio: format === "json" ? "ignore" : "inherit" });
  if (options["--save"]) await saveJson(options["--save"], result);
  print(format === "json" ? JSON.stringify(result, null, 2) : formatProfile(result));
  if (result.exit.signal) process.kill(process.pid, result.exit.signal);
  else if (result.exit.code !== 0) process.exitCode = result.exit.code ?? 1;
}

async function configCommand(args) {
  const { options, positionals } = parseOptions(args, { "--print": "boolean", "--format": "value", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.config);
  if (!options["--print"]) throw new CliError("config currently requires --print");
  if (positionals.length > 1) throw new CliError("config accepts at most one path");
  if (options["--format"] && options["--format"] !== "json") throw new CliError("--format must be json for config --print");
  const loaded = await loadConfig(positionals[0] ?? process.cwd());
  print(JSON.stringify({ schemaVersion: 1, configPath: loaded.configPath, config: loaded.config }, null, 2));
}

async function rulesCommand(args) {
  const { options, positionals } = parseOptions(args, { "--format": "value", "--json": "boolean", "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.rules);
  if (positionals.length) throw new CliError("rules does not accept positional arguments");
  const catalog = getRuleCatalog(); const format = outputFormat(options, ["human", "json"]);
  print(format === "json" ? JSON.stringify({ schemaVersion: 1, rules: catalog }, null, 2) : catalog.map((rule) => `${rule.id.padEnd(34)} ${rule.defaultSeverity.padEnd(7)} ${rule.title}`).join("\n"));
}

async function initCommand(args) {
  const { options, positionals } = parseOptions(args, { "--help": "boolean", "-h": "boolean" });
  if (options["--help"] || options["-h"]) return print(commandHelp.init);
  if (positionals.length > 1) throw new CliError("init accepts at most one directory");
  const directory = path.resolve(positionals[0] ?? process.cwd()); await mkdir(directory, { recursive: true });
  const target = path.join(directory, "velocity.config.json");
  const minimal = { minScore: 70, failOn: "error", bundleBudgets: { maxInitialJavaScriptKb: 250, maxCssKb: 100 }, rules: { "async/no-await-in-loop": "warning" }, ignore: ["node_modules", ".git", ".velocity", "dist", "build", "coverage", ".next", "**/*.min.js"] };
  await writeFile(target, `${JSON.stringify(minimal, null, 2)}\n`, { flag: "wx" }); print(`Created ${target}`);
}

export async function run(args) {
  if (!args.length || args[0] === "--help" || args[0] === "-h") return print(commandSummary);
  if (args[0] === "--version" || args[0] === "-v") { if (args.length > 1) throw new CliError("--version does not accept arguments"); return print(packageVersion); }
  const [command, ...rest] = args;
  if (["analyze", "check"].includes(command)) return analyzeCommand(command, rest);
  if (command === "build") return buildCommand(rest);
  if (command === "load") return loadCommand(rest);
  if (command === "optimize") return optimizeCommand(rest);
  if (command === "verify") return verifyCommand(rest);
  if (command === "compare") return compareCommand(rest);
  if (command === "bench") return benchCommand(rest);
  if (command === "profile") return profileCommand(rest);
  if (command === "config") return configCommand(rest);
  if (command === "rules") return rulesCommand(rest);
  if (command === "init") return initCommand(rest);
  throw new CliError(`Unknown command: ${command}\n\n${commandSummary}`);
}
