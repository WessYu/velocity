import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeProject, getRuleCatalog } from "./analyzer.js";
import { benchmark } from "./benchmark.js";
import { compareBenchmarks, compareReports } from "./comparison.js";
import { loadConfig } from "./config.js";
import { packageVersion } from "./package-meta.js";
import { profileNodeProcess } from "./profile.js";
import { formatAnalysisComparison, formatBenchmark, formatBenchmarkComparison, formatProfile, formatReport } from "./reporter.js";
import { toSarif } from "./sarif.js";

const commandSummary = `Velocity — performance risk analysis and regression budgets

Usage: velocity <command> [options]

Commands:
  analyze [path]              Find likely performance risks
  check [path]                Enforce severity and health-score budgets
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
    options[name] = optionValue;
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
  const minimal = { minScore: 70, failOn: "error", rules: { "async/no-await-in-loop": "warning" }, ignore: ["node_modules", ".git", ".velocity", "dist", "build", "coverage", ".next", "**/*.min.js"] };
  await writeFile(target, `${JSON.stringify(minimal, null, 2)}\n`, { flag: "wx" }); print(`Created ${target}`);
}

export async function run(args) {
  if (!args.length || args[0] === "--help" || args[0] === "-h") return print(commandSummary);
  if (args[0] === "--version" || args[0] === "-v") { if (args.length > 1) throw new CliError("--version does not accept arguments"); return print(packageVersion); }
  const [command, ...rest] = args;
  if (["analyze", "check"].includes(command)) return analyzeCommand(command, rest);
  if (command === "compare") return compareCommand(rest);
  if (command === "bench") return benchCommand(rest);
  if (command === "profile") return profileCommand(rest);
  if (command === "config") return configCommand(rest);
  if (command === "rules") return rulesCommand(rest);
  if (command === "init") return initCommand(rest);
  throw new CliError(`Unknown command: ${command}\n\n${commandSummary}`);
}
