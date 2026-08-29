export type Severity = "info" | "warning" | "error";
export type RuleSetting = Severity | "off";

export interface VelocityConfig {
  minScore: number;
  maxFileSizeKb: number;
  failOn: RuleSetting;
  ignore: string[];
  rules: Record<string, RuleSetting>;
  bundleBudgets: BundleBudgets;
}

export interface BundleBudgets { maxInitialJavaScriptKb?: number; maxTotalJavaScriptKb?: number; maxCssKb?: number; maxAssetKb?: number; maxChunkKb?: number }
export interface AssetSize { rawBytes: number; gzipBytes: number; brotliBytes: number; files: number }
export interface BuildArtifact { file: string; extension: string; category: "javascript" | "css" | "image" | "font" | "asset"; rawBytes: number; gzipBytes: number; brotliBytes: number; initial: boolean }
export interface BuildReport { schemaVersion: 1; kind: "build"; generatedAt: string; target: string; framework: string; outputDirectory: string; artifacts: BuildArtifact[]; summary: { total: AssetSize; javascript: AssetSize; initialJavaScript: AssetSize; css: AssetSize; images: AssetSize; fonts: AssetSize; assets: AssetSize }; budgets: BundleBudgets; budgetViolations: Array<{ budget: string; label: string; limitKb: number; actualKb: number; overByKb: number }> }
export interface BuildComparison { schemaVersion: 1; kind: "build-comparison"; baseline: BuildReport; current: BuildReport; metrics: Record<string, { before: number; after: number; deltaBytes: number; changePercent: number }> }
export interface LoadMetric { median: number; average: number; min: number; max: number; standardDeviation: number; coefficientOfVariation: number; samples: number[] }
export interface LoadReport { schemaVersion: 1; kind: "load"; url: string; device: "mobile" | "desktop"; runs: number; timeoutMs: number; measured: Record<"fcpMs" | "lcpMs" | "cls" | "tbtMs" | "speedIndexMs" | "ttfbMs" | "requests" | "transferBytes", number>; metrics: Record<string, LoadMetric>; unstable: boolean; recommendations: Array<{ id: string; title: string; evidence: string; recommendation: string; measured: false }> }
export type VerificationClassification = "improved" | "unchanged" | "inconclusive" | "regressed" | "failed";
export type OptimizationClassification = "safe-fix" | "measured-fix" | "review-required" | "recommendation";
export interface Optimization { id: string; classification: OptimizationClassification; title: string; evidence: string; expectedImpact: string; risk: string; files: string[]; patch: { file: string; start: number; end: number; before: string; after: string } | null; diff: string | null }
export interface OptimizationPlan { schemaVersion: 1; kind: "optimization-plan"; mode: "dry-run"; target: string; framework: string; findings: Array<Record<string, unknown>>; optimizations: Optimization[] }
export interface OptimizationRun { schemaVersion: 1; kind: "optimization-run"; id: string; selected: Optimization[]; rolledBack: string[]; verification: { classification: VerificationClassification; reason?: string } }

export interface VelocityIssue {
  rule: string;
  title: string;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  suggestion: string;
  fingerprint: string;
}

export interface VelocityReport {
  schemaVersion: 1;
  /** Compatibility alias for schemaVersion. */
  version: 1;
  target: string;
  generatedAt: string;
  project: { name: string; moduleType: string; language: "JavaScript" | "TypeScript"; packageManager: "npm" | "pnpm" | "yarn" | "bun" | null; frameworks: string[] };
  /** Heuristic health score, not a measured performance metric. */
  score: number;
  scoreVersion: 1;
  summary: { files: number; lines: number; bytes: number; errors: number; warnings: number; info: number; discoveryErrors: number };
  issues: VelocityIssue[];
  discoveryErrors: Array<{ path: string; message: string }>;
  config: VelocityConfig;
  configPath: string | null;
}

export interface BenchmarkOptions { runs?: number; warmup?: number; cwd?: string; instabilityThreshold?: number }
export interface RuntimeEnvironment { nodeVersion: string; platform: string; release: string; architecture: string; cpu: string | null }
export interface BenchmarkResult {
  schemaVersion: 1; velocityVersion: string; command: string[]; cwd: string; runs: number; warmup: number; samplesMs: number[];
  averageMs: number; medianMs: number; minMs: number; maxMs: number; p50Ms: number; p95Ms: number; standardDeviationMs: number;
  coefficientOfVariation: number; unstable: boolean; instabilityThreshold: number; environment: RuntimeEnvironment; timestamp: string;
}

export interface ProfileResult {
  schemaVersion: 1; velocityVersion: string; command: string[]; cwd: string; exit: { code: number | null; signal: string | null };
  pid: number; nodeVersion: string; durationMs: number; cpu: { userMs: number; systemMs: number };
  memory: { rssBytes: number; peakRssBytes: number; heapUsedBytes: number; heapTotalBytes: number; externalBytes: number };
  eventLoop: { utilization: number; activeMs: number; idleMs: number; delayMeanMs: number; delayP95Ms: number; delayP99Ms: number; delayMaxMs: number };
}

export interface RuleMetadata { id: string; title: string; description: string; defaultSeverity: Severity; category: string; rationale: string; suggestion: string }
export interface AnalysisComparison { schemaVersion: 1; kind: "analysis-comparison"; baselineScore: number; currentScore: number; scoreDelta: number; newIssues: VelocityIssue[]; resolvedIssues: VelocityIssue[]; summaryDelta: { errors: number; warnings: number; info: number } }
export interface BenchmarkComparison { schemaVersion: 1; kind: "benchmark-comparison"; averageChangePercent: number; p95ChangePercent: number; minChangePercent: number; reliable: boolean; warnings: string[]; baseline: BenchmarkResult; current: BenchmarkResult }

export class ConfigError extends Error { propertyPath: string }
export const defaultConfig: Readonly<VelocityConfig>;
/** Analyze JavaScript and TypeScript sources under target using parser-backed rules. */
export function analyzeProject(target?: string, options?: { config?: Partial<Omit<VelocityConfig, "rules">> & { rules?: Record<string, RuleSetting> } }): Promise<VelocityReport>;
/** Run a command repeatedly without a shell and retain every timing sample. */
export function benchmark(command: string, args?: string[], options?: BenchmarkOptions): Promise<BenchmarkResult>;
export function analyzeBuild(target?: string, options?: { runBuild?: boolean; outputDirectory?: string; budgets?: BundleBudgets }): Promise<BuildReport>;
export function compareBuilds(baseline: BuildReport, current: BuildReport): BuildComparison;
export function measureLoad(url: string, options?: { device?: "mobile" | "desktop"; runs?: number; timeoutMs?: number; browserPath?: string }): Promise<LoadReport>;
export function compareLoads(baseline: LoadReport, current: LoadReport, options?: { marginPercent?: number }): { schemaVersion: 1; kind: "load-comparison"; classification: VerificationClassification; marginPercent: number; baseline: LoadReport; current: LoadReport; metrics: Record<string, { before: number; after: number; changePercent: number }> };
export function createOptimizationPlan(target?: string, options?: { runBuild?: boolean }): Promise<OptimizationPlan>;
export function applyOptimizations(target?: string, options?: { fixes: string[]; marginPercent?: number }): Promise<OptimizationRun>;
export function verifyProject(target?: string, options?: { before?: string; after?: string; marginPercent?: number }): Promise<Record<string, unknown> & { classification: VerificationClassification }>;
/** Profile a direct Node.js process. Peak RSS is sampled and may miss very short peaks. */
export function profileNodeProcess(command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string | undefined>; stdio?: "inherit" | "ignore" }): Promise<ProfileResult>;
export function compareReports(baseline: VelocityReport, current: VelocityReport): AnalysisComparison;
export function compareBenchmarks(baseline: BenchmarkResult, current: BenchmarkResult, options?: { allowEnvironmentMismatch?: boolean }): BenchmarkComparison;
export function getRuleCatalog(): RuleMetadata[];
export function loadConfig(target: string): Promise<{ config: VelocityConfig; configPath: string | null }>;
export function mergeConfig(input?: Partial<Omit<VelocityConfig, "rules">> & { rules?: Record<string, RuleSetting> }): VelocityConfig;
export function toSarif(report: VelocityReport): Record<string, unknown>;
