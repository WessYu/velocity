# Velocity

Find performance risks, measure real behavior, and prevent regressions in JavaScript and TypeScript projects.

Velocity is a local CLI and ESM API for three related jobs:

- parser-backed static analysis for likely performance risks;
- real React, Vite, and Next.js bundle measurement with raw, gzip, and Brotli sizes;
- Chromium load measurement for FCP, LCP, CLS, TBT, Speed Index, TTFB, requests, and bytes;
- reviewable, explicitly authorized optimizations with scoped snapshots and rollback;
- reproducible command benchmarks with environment-aware comparisons;
- direct Node.js process profiling for CPU, memory, and event-loop behavior.

Its primary job is regression control: save versioned evidence, compare it in CI, and fail on new problems or measured regressions. Static findings and the health score are heuristic. Benchmark and profile values are measurements from the machine that ran them.

## Quick start

Requires Node.js 20, 22, or 24.

```bash
npm install --save-dev @wess2001/velocity
npx velocity analyze .
```

## Build, load, optimize, and verify

Measure a production build and enforce bundle budgets:

```bash
velocity build . --save .velocity/build-before.json \
  --max-initial-js 250 --max-total-js 600 --max-css 100 --max-chunk 200
velocity build . --compare .velocity/build-before.json --max-regression 2
```

Velocity detects Vite, React, and Next.js, runs the declared build unless `--no-build` is set, reads framework manifests, identifies initial and route chunks, and measures every emitted JavaScript, CSS, image, font, and other asset in raw, gzip, and Brotli bytes. Next.js `public/` assets are included.

Measure an actual URL in Chromium:

```bash
velocity load https://localhost:4173 --device mobile --runs 3 \
  --timeout 30000 --save .velocity/load-before.json
velocity load https://localhost:4173 --device desktop --runs 3 \
  --compare .velocity/load-desktop-before.json --margin 5
```

`load` reports measured values separately from threshold-based recommendations. TBT is calculated from lab long tasks and is always labeled as TBT; it is never presented as INP. Mobile runs use explicit network and CPU throttling. Speed Index is calculated from a 200 ms PNG filmstrip.

Optimization is dry-run by default:

```bash
velocity optimize .
velocity optimize . --apply --fix size-image-0123456789ab
velocity verify .
```

Every proposed change includes its classification (`safe-fix`, `measured-fix`, `review-required`, or `recommendation`), evidence, expected impact, risk, affected files, and unified diff. `--apply` requires each optimization ID explicitly. Velocity snapshots only affected files, checks that patch context has not changed, and runs build, typecheck, and tests. It never invokes `git reset`. On failure it restores only files changed by the current Velocity run. A `measured-fix` is also restored when the before/after build does not prove improvement above the configured noise margin.

`verify --before report.json --after report.json` compares saved build or load reports and returns `improved`, `unchanged`, `inconclusive`, `regressed`, or `failed`.

Typical output:

```text
Velocity performance risk report
checkout-api · TypeScript · Fastify
83/100 heuristic health score (formula v1) · 42 files · 5,901 lines

src/catalog.ts
  × 18:16 readFileSync blocks the Node.js event loop.
    node/no-blocking-fs — Use the corresponding asynchronous API where blocking affects concurrency...
```

Run a gate immediately:

```bash
npx velocity check . --min-score 85 --no-color
```

## Regression gate in CI

Create and review a baseline:

```bash
npx velocity analyze . --format json --save .velocity/analysis.json
```

Compare subsequent changes:

```bash
npx velocity compare .velocity/analysis.json . --max-score-drop 2
```

`compare` fails when a new error appears or the heuristic score drops beyond the budget. Fingerprints use rule, normalized file, semantic function context, normalized message, and occurrence—not line numbers—so unrelated line movement does not create a new finding.

Minimal GitHub Actions step:

```yaml
- run: npm ci
- run: npx velocity compare .velocity/analysis.json . --max-score-drop 2 --no-color
```

For GitHub Code Scanning:

```bash
npx velocity analyze . --format sarif --save velocity.sarif
```

The SARIF 2.1.0 document includes rule metadata, severity, locations, help links, and stable partial fingerprints.

## Static analysis

```bash
velocity analyze [path] [--format human|json|sarif] [--save file]
velocity check [path] [--min-score 70] [--format human|json|sarif]
velocity rules [--format human|json]
```

Velocity parses `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts` with an isolated Babel parser adapter. Rules inspect the AST and lexical bindings. For example, `readFileSync()` is only reported when its binding comes from `fs` or `node:fs`; a user function with that name is not reported.

Built-in rule documentation is in [`docs/rules`](docs/rules/README.md). Every rule has a stable ID and can be set to `off`, `info`, `warning`, or `error`, including `project/large-source-file` and suppression-governance rules.

### Health score

The numeric score is a deterministic, versioned health indicator—not a scientific measure of application speed.

Formula v1 starts at 100 and subtracts 12 per error, 5 per warning, and 1 per informational finding, with a floor of zero. Objective regression gates should prefer new fingerprints, explicit severities, and measured benchmark changes over the score alone.

## Configuration

Create a minimal file without overwriting an existing one:

```bash
velocity init [directory]
velocity config --print [path]
```

`velocity.config.json` is discovered from the target directory upward; the nearest file wins. Unknown properties, invalid values, and unknown rule IDs fail with the exact JSON property path.

```json
{
  "minScore": 80,
  "maxFileSizeKb": 250,
  "failOn": "error",
  "rules": {
    "js/repeated-array-passes": "off",
    "async/no-await-in-loop": "warning"
  },
  "ignore": ["node_modules", ".git", ".velocity", "dist", "build", "coverage", ".next", "**/*.min.js"]
}
```

Defaults are printed by `velocity config --print`. Ignore entries are glob-like path patterns; symlinks are not followed. Unreadable paths are preserved in versioned JSON diagnostics instead of aborting the complete scan. Generated directories are ignored by default.

### Reviewed suppressions

```js
// velocity-ignore-next-line node/no-blocking-fs -- required during synchronous process shutdown
fs.writeFileSync(reportPath, report);
```

Use `velocity-ignore-line` for a directive on the same line. A suppression must name an existing rule and contain a non-empty justification after `--`. Malformed directives are warnings; valid directives that suppress nothing are informational findings. Suppress narrowly only when the context has been measured or correctness requires the flagged behavior.

## Benchmark

```bash
velocity bench --runs 10 --warmup 2 --save .velocity/build.json -- npm run build
velocity bench --runs 10 --compare .velocity/build.json --max-regression 8 -- npm run build
```

The `--` boundary is absolute: every token after it belongs to the measured command. Commands run directly with `shell: false`.

Each schema-v1 result records the full command, cwd, warmups, raw samples, mean, median, min, max, p50, p95, standard deviation, coefficient of variation, instability threshold, Node/OS/architecture/CPU, Velocity version, and timestamp. No outlier is discarded.

Regression is `(current mean - baseline mean) / baseline mean × 100`. Commands must be identical. Environment differences are rejected unless `--allow-environment-mismatch` is explicit. A coefficient of variation over 15% marks a run unstable; unstable comparisons are shown but do not fail the regression budget because the evidence is not reliable enough.

Command failures include up to 64 KiB of captured stdout/stderr for diagnosis.

## Node.js profiler

```bash
velocity profile --save .velocity/profile.json -- node worker.js
```

The profiler accepts a direct `node` executable, preserves existing `NODE_OPTIONS`, supports paths with spaces, gives each process a collision-free report path, and reads only the main child report. It propagates the target exit status and cleans temporary files on success or failure.

It records process duration, user/system CPU, final RSS, sampled peak RSS, final heap/external memory, event-loop utilization, and event-loop delay. Peak RSS is sampled every 25 ms and can miss extremely short peaks. Heap and external values are final values, not peaks. Exit hooks that never run (for example, forceful termination) cannot produce a report. Profiling injects a Node preload probe but does not instrument application functions.

## Programmatic API

```js
import {
  analyzeProject,
  analyzeBuild,
  applyOptimizations,
  benchmark,
  compareBuilds,
  compareBenchmarks,
  compareLoads,
  compareReports,
  createOptimizationPlan,
  measureLoad,
  profileNodeProcess,
  toSarif,
  verifyProject
} from "@wess2001/velocity";

const report = await analyzeProject(".");
const timing = await benchmark("node", ["server.js"], { runs: 10, warmup: 2 });
const profile = await profileNodeProcess("node", ["worker.js"], { stdio: "ignore" });
```

The package exposes only documented ESM entry points and ships synchronized TypeScript declarations. Public result objects carry `schemaVersion: 1`. Invalid options throw typed built-in errors; configuration errors use `ConfigError` with `propertyPath`.

## Commands and exit codes

| Command | Purpose |
| --- | --- |
| `analyze [path]` | Report static performance risks |
| `check [path]` | Enforce severity and score budgets |
| `build [path]` | Build, measure assets, compare baselines, and enforce bundle budgets |
| `load <url>` | Collect repeated real-browser lab measurements |
| `optimize [path]` | Produce a dry-run plan or apply explicitly selected patches |
| `verify [path]` | Classify a saved comparison or the latest optimization run |
| `compare <baseline> [path]` | Enforce new-finding budgets |
| `bench -- <command>` | Measure and optionally compare a command |
| `profile -- <node-command>` | Profile one direct Node.js process |
| `config --print [path]` | Print resolved defaults and overrides |
| `rules` | Inspect the rule catalog |
| `init [path]` | Create config without overwrite |

- `0`: command completed and its gate passed;
- `1`: a budget failed or the profiled target exited unsuccessfully;
- `2`: invalid CLI usage, invalid configuration, incompatible baseline, or operational failure.

stdout contains the requested result. Errors and diagnostics use stderr. JSON and SARIF never contain ANSI color codes. Use `--no-color` for deterministic human logs.

## Compatibility and limitations

- Supported runtimes: maintained Node.js 20, 22, and 24 lines on Linux, Windows, and macOS.
- The parser handles standard Babel-supported JS/TS syntax; invalid or unsupported syntax becomes an explicit parse diagnostic.
- Static rules identify risk patterns, not proven slowdowns. They do not perform whole-program data flow or runtime hot-path detection.
- `async/no-await-in-loop` is contextual. Sequential iteration may be correct for ordering, rate limits, dependencies, or bounded memory; Velocity never recommends unbounded `Promise.all()` as a universal fix.
- Benchmark results depend on machine load, power state, caches, and environment. Use controlled runners and enough samples.
- The profiler covers the main Node process. Child processes write isolated data but are not aggregated.
- Velocity has no telemetry, hosted service, plugin API, or hidden uploads. Its only source rewrites are explicit `optimize --apply --fix <id>` selections with scoped snapshots.

## Development and release readiness

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run check
npm pack --dry-run
```

CI runs tests on Node 20/22/24 and all three major operating systems, self-analysis, coverage gates, and tarball installation. npm provenance metadata is prepared, but releases require a maintainer-controlled Trusted Publishing workflow and are never performed by the test pipeline.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## Roadmap

1. Improve binding and control-flow precision from fixture-backed false-positive reports.
2. Version documented baseline migration tooling before any schema v2 change.
3. Add statistically stronger repeated-run comparison only after cross-platform validation.
4. Consider a public rule API only after the internal rule contract remains stable across releases.

## License

MIT © WessYu
