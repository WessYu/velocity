function validateAnalysis(report, label) {
  if (report?.schemaVersion !== 1 && report?.version !== 1) throw new Error(`${label} is not a compatible Velocity analysis report`);
  if (!report.summary || !Array.isArray(report.issues) || !Number.isFinite(report.score)) throw new Error(`${label} is missing required analysis fields`);
  for (const key of ["errors", "warnings", "info"]) if (!Number.isInteger(report.summary[key])) throw new Error(`${label}.summary.${key} must be an integer`);
  for (const [index, issue] of report.issues.entries()) {
    if (!issue || typeof issue.rule !== "string" || typeof issue.file !== "string" || typeof issue.message !== "string" || !["info", "warning", "error"].includes(issue.severity)) throw new Error(`${label}.issues[${index}] is invalid`);
  }
}
function issueKey(issue) { return issue.fingerprint ?? `${issue.rule}\0${issue.file}\0${issue.message}`; }
export function compareReports(baseline, current) {
  validateAnalysis(baseline, "The baseline"); validateAnalysis(current, "The current report");
  const baselineKeys = new Set(baseline.issues.map(issueKey));
  const currentKeys = new Set(current.issues.map(issueKey));
  return {
    schemaVersion: 1, kind: "analysis-comparison", baselineScore: baseline.score, currentScore: current.score, scoreDelta: current.score - baseline.score,
    newIssues: current.issues.filter((issue) => !baselineKeys.has(issueKey(issue))), resolvedIssues: baseline.issues.filter((issue) => !currentKeys.has(issueKey(issue))),
    summaryDelta: { errors: current.summary.errors - baseline.summary.errors, warnings: current.summary.warnings - baseline.summary.warnings, info: current.summary.info - baseline.summary.info }
  };
}

function percentChange(before, after) { return before === 0 ? (after === 0 ? 0 : Number.POSITIVE_INFINITY) : ((after - before) / before) * 100; }
function environmentDifferences(a, b) {
  const keys = ["nodeVersion", "platform", "release", "architecture", "cpu"];
  return keys.filter((key) => a.environment?.[key] !== b.environment?.[key]).map((key) => `${key}: ${a.environment?.[key] ?? "unknown"} → ${b.environment?.[key] ?? "unknown"}`);
}
export function compareBenchmarks(baseline, current, options = {}) {
  for (const [label, value] of [["baseline", baseline], ["current", current]]) {
    if (value?.schemaVersion !== 1 || !Array.isArray(value.command) || !value.command.length || !Array.isArray(value.samplesMs) || !value.samplesMs.length || value.samplesMs.some((sample) => !Number.isFinite(sample)) || ![value.averageMs, value.p95Ms, value.minMs].every(Number.isFinite) || !value.environment || typeof value.environment !== "object") throw new Error(`The ${label} is not a compatible Velocity benchmark report`);
  }
  if (JSON.stringify(baseline.command) !== JSON.stringify(current.command)) throw new Error("Benchmark commands differ and cannot be compared");
  const differences = environmentDifferences(baseline, current);
  if (differences.length && !options.allowEnvironmentMismatch) throw new Error(`Benchmark environments differ (${differences.join(", ")}); pass allowEnvironmentMismatch only when this is intentional`);
  const warnings = differences.map((difference) => `Environment differs: ${difference}`);
  if (baseline.unstable) warnings.push("Baseline measurements are unstable.");
  if (current.unstable) warnings.push("Current measurements are unstable.");
  return { schemaVersion: 1, kind: "benchmark-comparison", averageChangePercent: percentChange(baseline.averageMs, current.averageMs), p95ChangePercent: percentChange(baseline.p95Ms, current.p95Ms), minChangePercent: percentChange(baseline.minMs, current.minMs), reliable: !baseline.unstable && !current.unstable, warnings, baseline, current };
}
