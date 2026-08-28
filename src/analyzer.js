import path from "node:path";
import { access, readFile, stat } from "node:fs/promises";
import { discoverSourceFiles, loadSource } from "./discovery.js";
import { defaultConfig, mergeConfig } from "./config.js";
import { coreRules } from "./rules/core.js";
import { maskNonCode } from "./rules/helpers.js";
import { detectProject } from "./project.js";

async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(root) {
  const metadata = await stat(root);
  const directory = metadata.isFile() ? path.dirname(root) : root;
  const configPath = path.join(directory, "velocity.config.json");
  if (!(await pathExists(configPath))) return { ...defaultConfig };

  try {
    return mergeConfig(JSON.parse(await readFile(configPath, "utf8")));
  } catch (error) {
    throw new Error(`Could not load ${configPath}: ${error.message}`);
  }
}

function scoreFor(issues) {
  const weights = { error: 12, warning: 5, info: 1 };
  return Math.max(0, 100 - issues.reduce((total, issue) => total + weights[issue.severity], 0));
}

function isSuppressed(source, line, ruleId) {
  const lines = source.split("\n");
  const current = lines[line - 1] ?? "";
  const previous = lines[line - 2] ?? "";
  const targetsRule = (text) => text.includes(ruleId) || text.includes(" all") || /velocity-ignore(?:-next-line|-line)?\s*$/.test(text.trim());
  return (current.includes("velocity-ignore-line") && targetsRule(current))
    || (previous.includes("velocity-ignore-next-line") && targetsRule(previous));
}

export async function analyzeProject(target = process.cwd(), options = {}) {
  const root = path.resolve(target);
  const rootMetadata = await stat(root);
  const rootDirectory = rootMetadata.isFile() ? path.dirname(root) : root;
  const config = mergeConfig({ ...(await loadConfig(root)), ...options.config });
  const files = await discoverSourceFiles(root, config.ignore);
  const project = await detectProject(rootDirectory, files);
  const issues = [];
  let totalBytes = 0;
  let totalLines = 0;

  for (const file of files) {
    const { source, bytes } = await loadSource(file);
    const analyzableSource = maskNonCode(source);
    const displayFile = path.relative(rootDirectory, file) || path.basename(file);
    totalBytes += bytes;
    totalLines += source.split("\n").length;

    if (bytes > config.maxFileSizeKb * 1024) {
      issues.push({
        rule: "project/large-source-file",
        title: "Large source file",
        severity: "warning",
        file: displayFile,
        line: 1,
        message: `${Math.ceil(bytes / 1024)} KB exceeds the configured ${config.maxFileSizeKb} KB limit.`,
        suggestion: "Split responsibilities or move large generated data out of source code."
      });
    }

    for (const rule of coreRules) {
      const ruleSetting = config.rules[rule.id];
      if (ruleSetting === "off") continue;
      for (const issue of rule.analyze(analyzableSource)) {
        if (isSuppressed(source, issue.line, rule.id)) continue;
        issues.push({ rule: rule.id, title: rule.title, file: displayFile, ...issue, severity: ruleSetting ?? issue.severity });
      }
    }
  }

  issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  return {
    version: 1,
    target: root,
    project,
    generatedAt: new Date().toISOString(),
    score: scoreFor(issues),
    summary: {
      files: files.length,
      lines: totalLines,
      bytes: totalBytes,
      errors: issues.filter((issue) => issue.severity === "error").length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      info: issues.filter((issue) => issue.severity === "info").length
    },
    issues,
    config
  };
}
