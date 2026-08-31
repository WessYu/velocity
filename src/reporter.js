const symbols = { error: "×", warning: "▲", info: "●" };
const colors = { error: "\u001b[31m", warning: "\u001b[33m", info: "\u001b[36m", dim: "\u001b[2m", reset: "\u001b[0m" };
function paint(value, color, enabled) { return enabled ? `${colors[color]}${value}${colors.reset}` : value; }

export function formatReport(report, options = {}) {
  const color = options.color ?? process.stdout.isTTY;
  const output = ["Velocity performance risk report"];
  const stack = [report.project.language, ...report.project.frameworks].join(" · ");
  output.push(`${report.project.name} · ${stack}`);
  output.push(`${paint(report.score, report.score >= 80 ? "info" : report.score >= 60 ? "warning" : "error", color)}/100 heuristic health score (formula v${report.scoreVersion}) · ${report.summary.files} files · ${report.summary.lines} lines`);
  if (!report.issues.length) return [...output, "", "No known performance risks found."].join("\n");
  let previousFile;
  for (const issue of report.issues) {
    if (issue.file !== previousFile) { output.push("", paint(issue.file, "dim", color)); previousFile = issue.file; }
    output.push(`  ${paint(symbols[issue.severity], issue.severity, color)} ${issue.line}:${issue.column ?? 1} ${issue.message}`);
    output.push(`    ${paint(issue.rule, "dim", color)} — ${issue.suggestion}`);
  }
  output.push("", `${report.summary.errors} errors · ${report.summary.warnings} warnings · ${report.summary.info} info`);
  if (report.summary.discoveryErrors) output.push(`${report.summary.discoveryErrors} paths could not be read; inspect JSON output for details.`);
  return output.join("\n");
}

export function formatBenchmark(result) {
  const number = (value) => `${value.toFixed(2)} ms`;
  return [
    `Velocity benchmark · ${result.command.join(" ")}`,
    `${result.runs} measured runs · ${result.warmup} warmup · CV ${(result.coefficientOfVariation * 100).toFixed(1)}%${result.unstable ? " (unstable)" : ""}`,
    "", `average  ${number(result.averageMs)}`, `median   ${number(result.medianMs)}`, `min      ${number(result.minMs)}`,
    `p50      ${number(result.p50Ms)}`, `p95      ${number(result.p95Ms)}`, `max      ${number(result.maxMs)}`, `std dev  ${number(result.standardDeviationMs)}`
  ].join("\n");
}

function bytes(value) { return `${(value / 1024 / 1024).toFixed(1)} MB`; }
export function formatProfile(result) {
  const percent = (value) => `${(value * 100).toFixed(1)}%`;
  const ms = (value) => `${value.toFixed(2)} ms`;
  return [
    `Velocity runtime profile · ${result.command.join(" ")}`, `Node ${result.nodeVersion} · PID ${result.pid} · exit ${result.exit.code ?? result.exit.signal}`,
    "", `duration           ${ms(result.durationMs)}`, `CPU user/system    ${ms(result.cpu.userMs)} / ${ms(result.cpu.systemMs)}`,
    `peak sampled RSS   ${bytes(result.memory.peakRssBytes)}`, `final RSS          ${bytes(result.memory.rssBytes)}`,
    `final heap used    ${bytes(result.memory.heapUsedBytes)}`, `event-loop usage   ${percent(result.eventLoop.utilization)}`,
    `event-loop p95     ${ms(result.eventLoop.delayP95Ms)}`, `event-loop p99     ${ms(result.eventLoop.delayP99Ms)}`, `event-loop max     ${ms(result.eventLoop.delayMaxMs)}`
  ].join("\n");
}

export function formatAnalysisComparison(comparison) {
  const delta = comparison.scoreDelta >= 0 ? `+${comparison.scoreDelta}` : `${comparison.scoreDelta}`;
  return ["Velocity analysis comparison", `score  ${comparison.baselineScore} → ${comparison.currentScore} (${delta}, heuristic)`, `new    ${comparison.newIssues.length}`, `fixed  ${comparison.resolvedIssues.length}`, `delta  ${comparison.summaryDelta.errors} errors · ${comparison.summaryDelta.warnings} warnings · ${comparison.summaryDelta.info} info`].join("\n");
}

export function formatBenchmarkComparison(comparison) {
  const change = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  const lines = ["Velocity benchmark comparison", `average  ${comparison.baseline.averageMs.toFixed(2)} ms → ${comparison.current.averageMs.toFixed(2)} ms (${change(comparison.averageChangePercent)})`, `p95      ${comparison.baseline.p95Ms.toFixed(2)} ms → ${comparison.current.p95Ms.toFixed(2)} ms (${change(comparison.p95ChangePercent)})`, `reliable ${comparison.reliable ? "yes" : "no"}`];
  for (const warning of comparison.warnings) lines.push(`warning  ${warning}`);
  return lines.join("\n");
}

function kib(value) { return Number.isFinite(value) ? `${(value / 1024).toFixed(1)} KiB` : "n/a"; }
function changePercent(value) { return value === null || value === undefined ? "n/a" : `${value >= 0 ? "+" : ""}${Number.isFinite(value) ? value.toFixed(1) : "infinite"}%`; }

export function formatBuild(report) {
  const rows = [
    ["initial JavaScript", report.summary.initialJavaScript],
    ["all JavaScript", report.summary.javascript],
    ["CSS", report.summary.css],
    ["images", report.summary.images],
    ["fonts", report.summary.fonts],
    ["all assets", report.summary.total]
  ];
  const output = [`Velocity build measurement - ${report.framework}`, `output ${report.outputDirectory}`, "", "category             raw        gzip       Brotli"];
  for (const [label, size] of rows) output.push(`${label.padEnd(20)} ${kib(size.rawBytes).padStart(10)} ${kib(size.gzipBytes).padStart(10)} ${kib(size.brotliBytes).padStart(10)}`);
  output.push("", `${report.artifacts.length} assets - ${report.insights.chunks.length} JavaScript chunks - ${report.insights.routes.length} routes`);
  for (const violation of report.budgetViolations) output.push(`BUDGET FAILED ${violation.label}: ${violation.actualKb.toFixed(1)} KiB > ${violation.limitKb.toFixed(1)} KiB`);
  return output.join("\n");
}

export function formatBuildComparison(comparison) {
  const output = ["Velocity build comparison"];
  for (const [name, metric] of Object.entries(comparison.metrics)) output.push(`${name.padEnd(28)} ${kib(metric.before)} -> ${kib(metric.after)} (${changePercent(metric.changePercent)})`);
  for (const violation of comparison.budgetViolations) output.push(`BUDGET FAILED ${violation.label}: ${violation.actualKb.toFixed(1)} KiB > ${violation.limitKb.toFixed(1)} KiB`);
  return output.join("\n");
}

export function formatLoad(report) {
  const labels = { fcpMs: "FCP", lcpMs: "LCP", cls: "CLS", tbtMs: "TBT (lab, not INP)", visualProgressIndexMs: "Visual progress index", ttfbMs: "TTFB", requests: "Requests", transferBytes: "Transferred bytes" };
  const output = [`Velocity browser load - ${report.device}`, `${report.url} - ${report.runs} measured run${report.runs === 1 ? "" : "s"}`, "", "Measured metrics"];
  for (const [key, label] of Object.entries(labels)) {
    const value = report.measured[key];
    const formatted = !Number.isFinite(value) ? "unavailable" : key === "cls" ? value.toFixed(3) : key === "requests" ? value.toFixed(0) : key === "transferBytes" ? kib(value) : `${value.toFixed(0)} ms`;
    const cv = report.metrics[key]?.coefficientOfVariation;
    output.push(`${label.padEnd(22)} ${formatted}${Number.isFinite(cv) && cv > 0.2 ? " (unstable)" : ""}`);
  }
  if (report.methodology.visualProgressIndex) output.push("", "visualProgressIndexMs is a Velocity approximation collected in a separate navigation; it is not Lighthouse Speed Index.");
  output.push("", "Recommendations (not measured metrics)");
  if (!report.recommendations.length) output.push("No threshold-based recommendations.");
  for (const item of report.recommendations) output.push(`- ${item.title}: ${item.recommendation}`);
  return output.join("\n");
}

export function formatLoadComparison(comparison) {
  const output = [`Velocity load comparison - ${comparison.classification}`];
  for (const [name, metric] of Object.entries(comparison.metrics)) {
    const before = Number.isFinite(metric.before) ? metric.before.toFixed(2) : "unavailable";
    const after = Number.isFinite(metric.after) ? metric.after.toFixed(2) : "unavailable";
    output.push(`${name.padEnd(24)} ${before} -> ${after} (${changePercent(metric.changePercent)})`);
  }
  for (const mismatch of comparison.environmentMismatches ?? []) output.push(`environment mismatch  ${mismatch.field}`);
  return output.join("\n");
}

export function formatOptimizationPlan(plan) {
  const output = [`Velocity optimization dry-run - ${plan.framework}`, `${plan.evidence.sourceFiles} source files - ${plan.optimizations.length} reviewable changes - ${plan.findings.length} recommendations`];
  for (const item of plan.optimizations) {
    output.push("", `[${item.classification}] ${item.id} - ${item.title}`, `evidence: ${item.evidence}`, `impact: ${item.expectedImpact}`, `risk: ${item.risk}`, `files: ${item.files.join(", ")}`);
    if (item.diff) output.push(item.diff.trimEnd());
  }
  for (const item of plan.findings) output.push("", `[${item.classification}] ${item.id}${item.file ? ` - ${item.file}${item.line ? `:${item.line}` : ""}` : ""}`, `evidence: ${item.evidence}`, `recommendation: ${item.recommendation}`);
  return output.join("\n");
}

export function formatOptimizationRun(run) {
  const output = [`Velocity optimization apply - ${run.verification.classification}`, `run ${run.id}`, `authorized ${run.selected.map((item) => item.id).join(", ")}`, `rolled back ${run.rolledBack.length ? run.rolledBack.join(", ") : "none"}`, `snapshot ${run.snapshot}`];
  for (const step of run.validation?.steps ?? []) output.push(`${step.name.padEnd(10)} ${step.status}`);
  for (const conflict of run.rollbackConflicts ?? []) output.push(`ROLLBACK CONFLICT ${conflict.file} - user edit preserved - recovery ${conflict.recovery}`);
  if (run.verification.reason) output.push(run.verification.reason);
  return output.join("\n");
}

export function formatVerification(result) {
  const output = [`Velocity verification - ${result.classification}`];
  if (result.reason) output.push(result.reason);
  if (result.metric) output.push(`${result.metric.before ?? "unavailable"} -> ${result.metric.after ?? "unavailable"} (${changePercent(result.metric.changePercent)})`);
  if (result.rolledBack?.length) output.push(`rolled back: ${result.rolledBack.join(", ")}`);
  for (const conflict of result.rollbackConflicts ?? []) output.push(`rollback conflict: ${conflict.file} - recovery ${conflict.recovery}`);
  return output.join("\n");
}
