import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAnalysisComparison,
  formatBenchmark,
  formatBenchmarkComparison,
  formatBuild,
  formatBuildComparison,
  formatLoad,
  formatLoadComparison,
  formatOptimizationPlan,
  formatOptimizationRun,
  formatProfile,
  formatReport,
  formatVerification
} from "../src/reporter.js";

function size(rawBytes = 1024) {
  return { rawBytes, gzipBytes: Math.round(rawBytes / 2), brotliBytes: Math.round(rawBytes / 3) };
}

test("human report formatter covers scores, colors, grouping and discovery failures", () => {
  const base = {
    project: { name: "fixture", language: "JavaScript", frameworks: ["React"] },
    scoreVersion: 1,
    summary: { files: 2, lines: 20, errors: 1, warnings: 1, info: 1, discoveryErrors: 1 }
  };
  assert.match(formatReport({ ...base, score: 90, issues: [] }, { color: false }), /No known performance risks/);
  const issues = [
    { file: "src/a.js", line: 1, column: null, severity: "error", message: "bad", rule: "x", suggestion: "fix" },
    { file: "src/a.js", line: 2, column: 4, severity: "warning", message: "warn", rule: "y", suggestion: "review" },
    { file: "src/b.js", line: 3, column: 2, severity: "info", message: "note", rule: "z", suggestion: "inspect" }
  ];
  const warning = formatReport({ ...base, score: 70, issues }, { color: true });
  assert.match(warning, /\u001b\[/);
  assert.match(warning, /paths could not be read/);
  assert.match(formatReport({ ...base, score: 40, issues }, { color: false }), /40\/100/);
});

test("benchmark, profile and comparison formatters cover stable and unstable outcomes", () => {
  const benchmark = { command: ["node", "x.js"], runs: 3, warmup: 1, coefficientOfVariation: 0.25, unstable: true, averageMs: 10, medianMs: 9, minMs: 8, p50Ms: 9, p95Ms: 12, maxMs: 13, standardDeviationMs: 2 };
  assert.match(formatBenchmark(benchmark), /unstable/);
  assert.doesNotMatch(formatBenchmark({ ...benchmark, unstable: false }), /\(unstable\)/);

  const profile = { command: ["node", "x.js"], nodeVersion: "v22", pid: 1, exit: { code: 0, signal: null }, durationMs: 10, cpu: { userMs: 2, systemMs: 1 }, memory: { peakRssBytes: 1024 * 1024, rssBytes: 512 * 1024, heapUsedBytes: 256 * 1024 }, eventLoop: { utilization: 0.5, delayP95Ms: 1, delayP99Ms: 2, delayMaxMs: 3 } };
  assert.match(formatProfile(profile), /exit 0/);
  assert.match(formatProfile({ ...profile, exit: { code: null, signal: "SIGTERM" } }), /SIGTERM/);

  assert.match(formatAnalysisComparison({ baselineScore: 70, currentScore: 80, scoreDelta: 10, newIssues: [], resolvedIssues: [], summaryDelta: { errors: 0, warnings: 0, info: 0 } }), /\+10/);
  assert.match(formatAnalysisComparison({ baselineScore: 80, currentScore: 70, scoreDelta: -10, newIssues: [1], resolvedIssues: [1], summaryDelta: { errors: 1, warnings: -1, info: 0 } }), /-10/);

  const comparison = { baseline: { averageMs: 10, p95Ms: 12 }, current: { averageMs: 11, p95Ms: 10 }, averageChangePercent: 10, p95ChangePercent: -16.7, reliable: false, warnings: ["unstable input"] };
  assert.match(formatBenchmarkComparison(comparison), /reliable no/);
  assert.match(formatBenchmarkComparison({ ...comparison, reliable: true, warnings: [] }), /reliable yes/);
});

test("build and load formatters cover budgets, finite/infinite deltas and metric-specific rendering", () => {
  const build = {
    framework: "Vite",
    outputDirectory: "dist",
    summary: { initialJavaScript: size(), javascript: size(2048), css: size(), images: size(), fonts: size(), total: size(4096) },
    artifacts: [{}, {}],
    insights: { chunks: [{}], routes: [{}, {}] },
    budgetViolations: [{ label: "initial JS", actualKb: 120, limitKb: 100 }]
  };
  assert.match(formatBuild(build), /BUDGET FAILED/);
  assert.doesNotMatch(formatBuild({ ...build, budgetViolations: [] }), /BUDGET FAILED/);

  const buildComparison = { metrics: { growing: { before: 1024, after: 2048, changePercent: 100 }, shrinking: { before: 2048, after: 1024, changePercent: -50 }, infinite: { before: 0, after: 1024, changePercent: Infinity } }, budgetViolations: build.budgetViolations };
  const buildText = formatBuildComparison(buildComparison);
  assert.match(buildText, /\+100\.0%/);
  assert.match(buildText, /-50\.0%/);
  assert.match(buildText, /infinite%/);
  assert.doesNotMatch(formatBuildComparison({ ...buildComparison, budgetViolations: [] }), /BUDGET FAILED/);

  const measured = { fcpMs: 100, lcpMs: 200, cls: 0.1234, tbtMs: 30, speedIndexMs: 150, ttfbMs: 50, requests: 7, transferBytes: 4096 };
  const metrics = Object.fromEntries(Object.keys(measured).map((key, index) => [key, { coefficientOfVariation: index === 0 ? 0.3 : 0.1 }]));
  const load = { device: "mobile", url: "https://example.test", runs: 1, measured, metrics, recommendations: [] };
  const loadText = formatLoad(load);
  assert.match(loadText, /1 measured run\n/);
  assert.match(loadText, /0\.123/);
  assert.match(loadText, /7/);
  assert.match(loadText, /4\.0 KiB/);
  assert.match(loadText, /unstable/);
  assert.match(loadText, /No threshold-based recommendations/);
  const recommendation = { title: "LCP", recommendation: "Improve hero delivery" };
  assert.match(formatLoad({ ...load, runs: 2, recommendations: [recommendation] }), /2 measured runs/);

  const loadComparison = { classification: "improved", metrics: { lcpMs: { before: 200, after: 150, changePercent: -25 }, transferBytes: { before: 0, after: 100, changePercent: Infinity } } };
  assert.match(formatLoadComparison(loadComparison), /improved/);
  assert.match(formatLoadComparison(loadComparison), /infinite%/);
});

test("optimization and verification formatters cover optional patches, locations, rollback and reasons", () => {
  const plan = {
    framework: "Vite",
    evidence: { sourceFiles: 2 },
    optimizations: [{ classification: "safe-fix", id: "size-image-1", title: "Size image", evidence: "known dimensions", expectedImpact: "less CLS", risk: "low", files: ["src/a.jsx"], diff: "Index: src/a.jsx\n+ width" }, { classification: "review-required", id: "script-1", title: "Script", evidence: "blocking", expectedImpact: "FCP", risk: "order", files: ["src/b.jsx"], diff: null }],
    findings: [{ classification: "recommendation", id: "with-location", file: "src/a.jsx", line: 3, evidence: "x", recommendation: "y" }, { classification: "recommendation", id: "file-only", file: "src/b.jsx", line: null, evidence: "x", recommendation: "y" }, { classification: "recommendation", id: "global", file: null, line: null, evidence: "x", recommendation: "y" }]
  };
  const planText = formatOptimizationPlan(plan);
  assert.match(planText, /src\/a\.jsx:3/);
  assert.match(planText, /\+ width/);
  assert.match(planText, /\[recommendation\] global/);

  const run = { id: "run-1", selected: [{ id: "a" }], rolledBack: [], snapshot: ".velocity/x", validation: null, verification: { classification: "improved" } };
  assert.match(formatOptimizationRun(run), /rolled back none/);
  const rolled = { ...run, rolledBack: ["a"], validation: { steps: [{ name: "build", status: "passed" }] }, verification: { classification: "failed", reason: "regression" } };
  assert.match(formatOptimizationRun(rolled), /rolled back a/);
  assert.match(formatOptimizationRun(rolled), /regression/);

  assert.equal(formatVerification({ classification: "unchanged" }), "Velocity verification - unchanged");
  const verification = { classification: "regressed", reason: "too large", metric: { before: 100, after: 150, changePercent: 50 }, rolledBack: ["a", "b"] };
  const verificationText = formatVerification(verification);
  assert.match(verificationText, /too large/);
  assert.match(verificationText, /\+50\.0%/);
  assert.match(verificationText, /rolled back: a, b/);
});
