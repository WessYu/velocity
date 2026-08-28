import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeProject } from "./analyzer.js";
import { benchmark } from "./benchmark.js";
import { profileNodeProcess } from "./profile.js";
import { compareBenchmarks, compareReports } from "./comparison.js";
import { formatAnalysisComparison, formatBenchmark, formatBenchmarkComparison, formatProfile, formatReport } from "./reporter.js";

const help = `Velocity — performance diagnostics for JavaScript and TypeScript

Usage:
  velocity analyze [path] [--json] [--min-score 70]
  velocity check [path] [--min-score 70]
  velocity compare <baseline.json> [path] [--max-score-drop 0]
  velocity bench [--runs 5] [--save file] -- <command> [...args]
  velocity profile [--save file] -- <node-command> [...args]
  velocity init [path]

Commands:
  analyze  Find likely performance risks and print a report
  check    Analyze and fail when the score or severity budget is exceeded
  compare  Compare the current analysis with a saved baseline
  bench    Measure a command repeatedly using a warmup phase
  profile  Measure CPU, memory and event-loop behavior of a Node.js process
  init     Create a documented velocity.config.json
`;

function valueAfter(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function positional(args) {
  return args.filter((value, index) => !value.startsWith("--") && (index === 0 || !args[index - 1].startsWith("--")));
}

function severityFails(report, threshold) {
  const rank = { info: 1, warning: 2, error: 3 };
  return report.issues.some((issue) => rank[issue.severity] >= rank[threshold]);
}

async function saveJson(file, value) {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function analyzeCommand(command, args) {
  const target = positional(args)[0] ?? process.cwd();
  const minScoreValue = valueAfter(args, "--min-score", undefined);
  const config = minScoreValue === undefined ? {} : { minScore: Number(minScoreValue) };
  const report = await analyzeProject(target, { config });
  const savePath = valueAfter(args, "--save", undefined);
  if (savePath) await saveJson(savePath, report);
  const json = args.includes("--json");
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report, { color: !args.includes("--no-color") }));

  if (command === "check" && (report.score < report.config.minScore || severityFails(report, report.config.failOn))) {
    process.exitCode = 1;
  }
}

async function benchCommand(args) {
  const separator = args.indexOf("--");
  if (separator === -1 || !args[separator + 1]) throw new Error("bench requires -- followed by a command");
  const runs = Number(valueAfter(args.slice(0, separator), "--runs", 5));
  const warmup = Number(valueAfter(args.slice(0, separator), "--warmup", 1));
  const [command, ...commandArgs] = args.slice(separator + 1);
  const result = await benchmark(command, commandArgs, { runs, warmup, cwd: process.cwd() });
  const savePath = valueAfter(args.slice(0, separator), "--save", undefined);
  if (savePath) await saveJson(savePath, result);
  const comparePath = valueAfter(args.slice(0, separator), "--compare", undefined);
  if (comparePath) {
    const baseline = JSON.parse(await readFile(path.resolve(comparePath), "utf8"));
    const comparison = compareBenchmarks(baseline, result);
    console.log(args.includes("--json") ? JSON.stringify(comparison, null, 2) : formatBenchmarkComparison(comparison));
    const maxRegression = Number(valueAfter(args.slice(0, separator), "--max-regression", 10));
    if (comparison.averageChangePercent > maxRegression) process.exitCode = 1;
    return;
  }
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatBenchmark(result));
}

async function compareCommand(args) {
  const values = positional(args);
  if (!values[0]) throw new Error("compare requires a baseline JSON file");
  const baseline = JSON.parse(await readFile(path.resolve(values[0]), "utf8"));
  const current = await analyzeProject(values[1] ?? process.cwd());
  const comparison = compareReports(baseline, current);
  console.log(args.includes("--json") ? JSON.stringify(comparison, null, 2) : formatAnalysisComparison(comparison));
  const maxScoreDrop = Number(valueAfter(args, "--max-score-drop", 0));
  if (comparison.scoreDelta < -maxScoreDrop || comparison.newIssues.some((issue) => issue.severity === "error")) process.exitCode = 1;
}

async function profileCommand(args) {
  const separator = args.indexOf("--");
  if (separator === -1 || !args[separator + 1]) throw new Error("profile requires -- followed by a Node.js command");
  const [command, ...commandArgs] = args.slice(separator + 1);
  const result = await profileNodeProcess(command, commandArgs, { cwd: process.cwd(), stdio: args.includes("--json") ? "ignore" : "inherit" });
  const savePath = valueAfter(args.slice(0, separator), "--save", undefined);
  if (savePath) await saveJson(savePath, result);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatProfile(result));
  if (result.exit.code !== 0) process.exitCode = result.exit.code ?? 1;
}

async function initCommand(args) {
  const target = path.resolve(positional(args)[0] ?? process.cwd(), "velocity.config.json");
  const contents = `${JSON.stringify({
    minScore: 70,
    maxFileSizeKb: 250,
    failOn: "error",
    rules: {},
    ignore: ["node_modules", ".git", "dist", "build", "coverage", ".next"]
  }, null, 2)}\n`;
  await writeFile(target, contents, { flag: "wx" });
  console.log(`Created ${target}`);
}

export async function run(args) {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(help);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log("0.1.0");
    return;
  }

  const [command, ...rest] = args;
  if (command === "analyze" || command === "check") return analyzeCommand(command, rest);
  if (command === "compare") return compareCommand(rest);
  if (command === "bench") return benchCommand(rest);
  if (command === "profile") return profileCommand(rest);
  if (command === "init") return initCommand(rest);
  throw new Error(`Unknown command: ${command}\n\n${help}`);
}
