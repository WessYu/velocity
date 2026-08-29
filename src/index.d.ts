export type Severity = "info" | "warning" | "error";
export type RuleSetting = Severity | "off";

export interface VelocityConfig {
  minScore: number;
  maxFileSizeKb: number;
  failOn: RuleSetting;
  ignore: string[];
  rules: Record<string, RuleSetting>;
}

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
/** Profile a direct Node.js process. Peak RSS is sampled and may miss very short peaks. */
export function profileNodeProcess(command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string | undefined>; stdio?: "inherit" | "ignore" }): Promise<ProfileResult>;
export function compareReports(baseline: VelocityReport, current: VelocityReport): AnalysisComparison;
export function compareBenchmarks(baseline: BenchmarkResult, current: BenchmarkResult, options?: { allowEnvironmentMismatch?: boolean }): BenchmarkComparison;
export function getRuleCatalog(): RuleMetadata[];
export function loadConfig(target: string): Promise<{ config: VelocityConfig; configPath: string | null }>;
export function mergeConfig(input?: Partial<Omit<VelocityConfig, "rules">> & { rules?: Record<string, RuleSetting> }): VelocityConfig;
export function toSarif(report: VelocityReport): Record<string, unknown>;
