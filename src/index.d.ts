export type Severity = "info" | "warning" | "error";

export interface VelocityConfig {
  minScore: number;
  maxFileSizeKb: number;
  failOn: Severity;
  ignore: string[];
  rules: Record<string, Severity | "off">;
}

export interface VelocityIssue {
  rule: string;
  title: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  suggestion: string;
}

export interface VelocityReport {
  version: 1;
  target: string;
  generatedAt: string;
  project: {
    name: string;
    moduleType: string;
    language: "JavaScript" | "TypeScript";
    packageManager: "npm" | "pnpm" | "yarn" | "bun" | null;
    frameworks: string[];
  };
  score: number;
  summary: {
    files: number;
    lines: number;
    bytes: number;
    errors: number;
    warnings: number;
    info: number;
  };
  issues: VelocityIssue[];
  config: VelocityConfig;
}

export interface BenchmarkOptions {
  runs?: number;
  warmup?: number;
  cwd?: string;
}

export interface BenchmarkResult {
  command: string[];
  runs: number;
  warmup: number;
  samplesMs: number[];
  averageMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

export interface ProfileResult {
  schemaVersion: 1;
  command: string[];
  exit: { code: number | null; signal: string | null };
  pid: number;
  nodeVersion: string;
  durationMs: number;
  cpu: { userMs: number; systemMs: number };
  memory: {
    rssBytes: number;
    peakRssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  eventLoop: {
    utilization: number;
    activeMs: number;
    idleMs: number;
    delayMeanMs: number;
    delayP95Ms: number;
    delayP99Ms: number;
    delayMaxMs: number;
  };
}

export const defaultConfig: Readonly<VelocityConfig>;
export function analyzeProject(target?: string, options?: { config?: Partial<VelocityConfig> }): Promise<VelocityReport>;
export function benchmark(command: string, args?: string[], options?: BenchmarkOptions): Promise<BenchmarkResult>;
export function profileNodeProcess(command: string, args?: string[], options?: { cwd?: string; env?: Record<string, string | undefined>; stdio?: "inherit" | "ignore" }): Promise<ProfileResult>;
export function compareReports(baseline: VelocityReport, current: VelocityReport): {
  kind: "analysis-comparison";
  baselineScore: number;
  currentScore: number;
  scoreDelta: number;
  newIssues: VelocityIssue[];
  resolvedIssues: VelocityIssue[];
  summaryDelta: { errors: number; warnings: number; info: number };
};
export function compareBenchmarks(baseline: BenchmarkResult, current: BenchmarkResult): {
  kind: "benchmark-comparison";
  averageChangePercent: number;
  p95ChangePercent: number;
  minChangePercent: number;
  baseline: BenchmarkResult;
  current: BenchmarkResult;
};
