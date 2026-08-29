import path from "node:path";
import { stat } from "node:fs/promises";
import { buildBindings } from "./ast.js";
import { loadConfig, mergeConfig } from "./config.js";
import { discoverSourceFiles, loadSource } from "./discovery.js";
import { addFingerprints } from "./fingerprint.js";
import { parseSource, ParseError } from "./parser.js";
import { detectProject } from "./project.js";
import { coreRules, largeSourceFile, ruleById } from "./rules/core.js";
import { calculateHealthScore, SCORE_VERSION } from "./score.js";
import { applySuppressions } from "./suppressions.js";

export { loadConfig } from "./config.js";

function applySeverity(issue, config) {
  const setting = config.rules[issue.rule];
  return setting === "off" ? null : { ...issue, severity: setting ?? issue.severity };
}

async function analyzeFile(file, rootDirectory, config) {
  const displayFile = (path.relative(rootDirectory, file) || path.basename(file)).replaceAll("\\", "/");
  const { source, bytes } = await loadSource(file);
  let ast;
  try { ast = parseSource(source, file); }
  catch (error) {
    if (!(error instanceof ParseError)) throw error;
    return { bytes, lines: source.split(/\r?\n/).length, issues: [{ rule: "velocity/parse-error", title: "Source could not be parsed", severity: "error", file: displayFile, line: error.line ?? 1, column: error.column ?? 1, endLine: error.line ?? 1, endColumn: error.column ?? 1, message: error.message, suggestion: "Fix the syntax error or ignore generated syntax unsupported by the configured parser.", symbol: "parse" }] };
  }

  const context = { ast, source, file, displayFile, bindings: buildBindings(ast) };
  const raw = [];
  if (bytes > config.maxFileSizeKb * 1024 && config.rules[largeSourceFile.id] !== "off") {
    raw.push({ rule: largeSourceFile.id, title: largeSourceFile.title, severity: largeSourceFile.defaultSeverity, file: displayFile, line: 1, column: 1, endLine: 1, endColumn: 1, message: `${Math.ceil(bytes / 1024)} KB exceeds the configured ${config.maxFileSizeKb} KB limit.`, suggestion: largeSourceFile.suggestion, symbol: "file" });
  }
  for (const rule of coreRules) {
    if (config.rules[rule.id] === "off") continue;
    for (const finding of rule.analyze(context)) raw.push({ rule: rule.id, title: rule.title, severity: rule.defaultSeverity, file: displayFile, ...finding });
  }
  const suppressed = applySuppressions(ast, raw, displayFile);
  const issues = [...suppressed.findings, ...suppressed.diagnostics].map((issue) => applySeverity(issue, config)).filter(Boolean);
  return { bytes, lines: source.split(/\r?\n/).length, issues };
}

async function mapWithConcurrency(values, limit, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      // velocity-ignore-next-line async/no-await-in-loop -- worker pool intentionally bounds parser and filesystem concurrency
      results[index] = await operation(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function analyzeProject(target = process.cwd(), options = {}) {
  const root = path.resolve(target);
  const metadata = await stat(root);
  const rootDirectory = metadata.isFile() ? path.dirname(root) : root;
  const loaded = await loadConfig(root);
  const overrideInput = options.config ?? {};
  const config = mergeConfig({ ...loaded.config, ...overrideInput, rules: { ...loaded.config.rules, ...(overrideInput.rules ?? {}) }, bundleBudgets: { ...loaded.config.bundleBudgets, ...(overrideInput.bundleBudgets ?? {}) } });
  const discovery = await discoverSourceFiles(root, config.ignore);
  const project = await detectProject(rootDirectory, discovery.files);
  const results = await mapWithConcurrency(discovery.files, 8, (file) => analyzeFile(file, rootDirectory, config));
  const rawIssues = results.flatMap((result) => result.issues);
  rawIssues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  const issues = addFingerprints(rawIssues);
  const count = (severity) => issues.filter((issue) => issue.severity === severity).length;
  return {
    schemaVersion: 1,
    version: 1,
    target: root,
    project,
    generatedAt: new Date().toISOString(),
    score: calculateHealthScore(issues),
    scoreVersion: SCORE_VERSION,
    summary: { files: discovery.files.length, lines: results.reduce((sum, result) => sum + result.lines, 0), bytes: results.reduce((sum, result) => sum + result.bytes, 0), errors: count("error"), warnings: count("warning"), info: count("info"), discoveryErrors: discovery.errors.length },
    issues,
    discoveryErrors: discovery.errors,
    config,
    configPath: loaded.configPath
  };
}

export function getRuleCatalog() {
  return [...ruleById.values()].map(({ analyze: _analyze, ...metadata }) => metadata);
}
