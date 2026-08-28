function issueKey(issue) {
  return `${issue.rule}\u0000${issue.file}\u0000${issue.message}`;
}

export function compareReports(baseline, current) {
  if (baseline?.version !== 1 || !baseline.summary || !Array.isArray(baseline.issues)) {
    throw new Error("The baseline is not a compatible Velocity analysis report");
  }

  const baselineKeys = new Set(baseline.issues.map(issueKey));
  const currentKeys = new Set(current.issues.map(issueKey));
  const newIssues = current.issues.filter((issue) => !baselineKeys.has(issueKey(issue)));
  const resolvedIssues = baseline.issues.filter((issue) => !currentKeys.has(issueKey(issue)));

  return {
    kind: "analysis-comparison",
    baselineScore: baseline.score,
    currentScore: current.score,
    scoreDelta: current.score - baseline.score,
    newIssues,
    resolvedIssues,
    summaryDelta: {
      errors: current.summary.errors - baseline.summary.errors,
      warnings: current.summary.warnings - baseline.summary.warnings,
      info: current.summary.info - baseline.summary.info
    }
  };
}

function percentChange(before, after) {
  if (before === 0) return after === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((after - before) / before) * 100;
}

export function compareBenchmarks(baseline, current) {
  if (!baseline?.samplesMs || !Number.isFinite(baseline.averageMs)) {
    throw new Error("The baseline is not a compatible Velocity benchmark report");
  }

  return {
    kind: "benchmark-comparison",
    averageChangePercent: percentChange(baseline.averageMs, current.averageMs),
    p95ChangePercent: percentChange(baseline.p95Ms, current.p95Ms),
    minChangePercent: percentChange(baseline.minMs, current.minMs),
    baseline,
    current
  };
}
