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
