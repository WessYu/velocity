# Velocity

<p align="left">
  <a href="https://www.npmjs.com/package/@wess2001/velocity"><img alt="npm version" src="https://img.shields.io/npm/v/%40wess2001%2Fvelocity?logo=npm&label=npm"></a>
  <a href="https://github.com/WessYu/velocity/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/WessYu/velocity/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js 20+" src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <img alt="npm provenance" src="https://img.shields.io/badge/npm-provenance-enabled-5C2D91">
</p>

**Performance gates for JavaScript and TypeScript projects — from source code to real runtime behavior.**

Velocity is a local CLI and ESM API that helps teams find likely performance risks, measure builds and browser behavior, compare baselines, and fail CI when a regression exceeds an explicit budget.

It combines six parts of one workflow:

- **Analyze** source code with parser-backed, binding-aware rules.
- **Build** React, Vite, and Next.js projects and measure emitted assets.
- **Load** a real URL in Chromium and collect repeatable lab metrics.
- **Optimize** with reviewable patches, explicit authorization, validation, and rollback.
- **Benchmark** commands with environment-aware regression comparisons.
- **Profile** Node.js processes for CPU, memory, and event-loop behavior.

Velocity keeps **heuristics** and **measurements** separate. Static findings and the health score are indicators; build, load, benchmark, and profile values are measurements from the environment that produced them.

## Why Velocity?

Performance tooling is often split across linters, bundle analyzers, ad-hoc benchmark scripts, browser tooling, and CI glue. Velocity gives those checks one versioned workflow and one regression model without turning optimization into an opaque auto-rewrite step.

- **CI-first:** save baselines, compare later, and return deterministic exit codes.
- **Evidence-first:** measured regressions are preferred over score changes whenever possible.
- **Reviewable:** optimizations expose evidence, impact, risk, files, and a unified diff before anything changes.
- **Conservative:** no destructive Git reset, no telemetry, no hidden uploads, and no automatic lazy-loading decision based only on JSX source order.
- **Cross-platform:** CI verifies Node.js 20, 22, and 24 on Linux plus Node.js 22 on Windows and macOS.

## Quick start

Requires Node.js 20 or newer.

```bash
npm install --save-dev @wess2001/velocity
npx velocity analyze .
```

Turn the analysis into a CI gate:

```bash
npx velocity check . --min-score 85 --no-color
```

## The workflow in 60 seconds

### 1. Find likely risks

```bash
npx velocity analyze .
```

```text
Velocity performance risk report
checkout-api · TypeScript · Fastify
83/100 heuristic health score (formula v1) · 42 files · 5,901 lines

src/catalog.ts
  × 18:16 readFileSync blocks the Node.js event loop.
    node/no-blocking-fs — Use the corresponding asynchronous API where blocking affects concurrency...
```

### 2. Save a baseline

```bash
npx velocity analyze . --format json --save .velocity/analysis.json
```

### 3. Fail on a regression

```bash
npx velocity compare .velocity/analysis.json . --max-score-drop 2
```

`compare` fails when a new error appears or the heuristic score drops beyond the configured budget. Fingerprints use rule, normalized file, semantic function context, normalized message, and occurrence rather than line numbers, so unrelated line movement does not create a new finding.

### 4. Add it to CI

```yaml
- run: npm ci
- run: npx velocity compare .velocity/analysis.json . --max-score-drop 2 --no-color
```

For GitHub Code Scanning:

```bash
npx velocity analyze . --format sarif --save velocity.sarif
```

Velocity emits SARIF 2.1.0 with rule metadata, severity, locations, help links, and stable partial fingerprints.

## Command map

| Command | What it measures or controls | Typical use |
| --- | --- | --- |
| `analyze [path]` | Static performance-risk patterns | Local review, JSON/SARIF output |
| `check [path]` | Severity + heuristic score budgets | CI gate |
| `build [path]` | Raw, gzip, Brotli asset sizes | Bundle budgets and regressions |
| `load <url>` | Browser lab metrics | Front-end runtime regression checks |
| `optimize [path]` | Reviewable source changes | Explicit, validated fixes |
| `verify [path]` | Before/after build or load evidence | Improvement classification |
| `compare <baseline> [path]` | Static baseline deltas | New-finding gate |
| `bench -- <command>` | Repeated command timing | Build/script performance |
| `profile -- <node-command>` | CPU, memory, event loop | Node.js runtime profiling |
| `config --print [path]` | Resolved configuration | Debug config precedence |
| `rules` | Rule catalog | Inspect available checks |
| `init [path]` | Minimal config file | Project setup |

## Build measurement

Measure a production build and enforce bundle budgets:

```bash
velocity build . --save .velocity/build-before.json \
  --max-initial-js 250 --max-total-js 600 --max-css 100 --max-chunk 200

velocity build . \
  --compare .velocity/build-before.json \
  --max-regression 2
```

Velocity detects Vite, React, and Next.js, runs the declared build unless `--no-build` is set, reads framework manifests, identifies initial and route chunks, and measures emitted JavaScript, CSS, images, fonts, and other assets in raw, gzip, and Brotli bytes. Next.js `public/` assets are included.

## Real-browser load measurement

Measure an actual URL in Chromium:

```bash
velocity load https://localhost:4173 \
  --device mobile \
  --runs 3 \
  --timeout 30000 \
  --save .velocity/load-before.json

velocity load https://localhost:4173 \
  --device desktop \
  --runs 3 \
  --compare .velocity/load-desktop-before.json \
  --margin 5
```

`load` collects FCP, LCP, CLS, TBT, Speed Index, TTFB, request count, and transferred bytes. Threshold-based recommendations are kept separate from measurements.

TBT is calculated from lab long tasks and is always labeled **TBT**; it is never presented as INP. Mobile runs use explicit network and CPU throttling. Speed Index is calculated from a 200 ms PNG filmstrip.

## Reviewable optimization

Optimization is dry-run by default:

```bash
velocity optimize .
velocity optimize . --apply --fix size-image-0123456789ab
velocity verify .
```

Every proposed change includes a classification (`safe-fix`, `measured-fix`, `review-required`, or `recommendation`), evidence, expected impact, risk, affected files, and unified diff.

`--apply` requires each optimization ID explicitly. Velocity snapshots only affected files, checks that patch context has not changed, and runs build, typecheck, and tests. On failure it restores only files changed by the current Velocity run.

A `measured-fix` is also restored when before/after evidence does not prove an improvement above the configured noise margin.

```bash
velocity verify --before report-before.json --after report-after.json
```

Verification classifies the result as `improved`, `unchanged`, `inconclusive`, `regressed`, or `failed`.

## Static analysis

```bash
velocity analyze [path] [--format human|json|sarif] [--save file]
velocity check [path] [--min-score 70] [--format human|json|sarif]
velocity rules [--format human|json]
```

Velocity parses `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts` through an isolated Babel parser adapter. Rules inspect the AST and lexical bindings.

For example, `readFileSync()` is reported only when its binding resolves to `fs` or `node:fs`; a user-defined function with the same name is not treated as a Node.js filesystem call.

Rule documentation lives in [`docs/rules`](docs/rules/README.md). Every rule has a stable ID and can be configured as `off`, `info`, `warning`, or `error`.

### Health score

The score is a deterministic, versioned health indicator — **not a scientific measure of application speed**.

Formula v1 starts at 100 and subtracts:

- 12 per error;
- 5 per warning;
- 1 per informational finding;
- with a floor of zero.

Objective regression gates should prefer new fingerprints, explicit severities, and measured changes over the score alone.

## Configuration

Create a minimal configuration without overwriting an existing one:

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
  "ignore": [
    "node_modules",
    ".git",
    ".velocity",
    "dist",
    "build",
    "coverage",
    ".next",
    "**/*.min.js"
  ]
}
```

Defaults are printed by `velocity config --print`. Ignore entries are glob-like path patterns; symlinks are not followed. Unreadable paths are preserved in versioned JSON diagnostics instead of aborting the complete scan.

### Reviewed suppressions

```js
// velocity-ignore-next-line node/no-blocking-fs -- required during synchronous process shutdown
fs.writeFileSync(reportPath, report);
```

Use `velocity-ignore-line` for a directive on the same line. A suppression must name an existing rule and include a non-empty justification after `--`.

Malformed directives are warnings. Valid directives that suppress nothing are informational findings, which helps keep old exceptions visible instead of silently accumulating.

## Benchmark

```bash
velocity bench --runs 10 --warmup 2 --save .velocity/build.json -- npm run build
velocity bench --runs 10 --compare .velocity/build.json --max-regression 8 -- npm run build
```

The `--` boundary is absolute: every token after it belongs to the measured command. Commands run directly with `shell: false`.

Each schema-v1 result records the command, cwd, warmups, raw samples, mean, median, min, max, p50, p95, standard deviation, coefficient of variation, instability threshold, Node/OS/architecture/CPU, Velocity version, and timestamp. No outlier is discarded.

Regression is calculated as:

```text
(current mean - baseline mean) / baseline mean × 100
```

Commands must be identical. Environment differences are rejected unless `--allow-environment-mismatch` is explicit. A coefficient of variation above 15% marks a run unstable; unstable comparisons are reported but do not fail the regression budget because the evidence is not reliable enough.

Command failures include up to 64 KiB of captured stdout/stderr for diagnosis.

## Node.js profiler

```bash
velocity profile --save .velocity/profile.json -- node worker.js
```

The profiler accepts a direct `node` executable, preserves existing `NODE_OPTIONS`, supports paths with spaces, gives each process a collision-free report path, and reads only the main child report.

It records:

- process duration;
- user/system CPU time;
- final RSS and sampled peak RSS;
- final heap and external memory;
- event-loop utilization;
- event-loop delay.

Peak RSS is sampled every 25 ms and can miss extremely short peaks. Heap and external values are final values, not peaks. Exit hooks that never run — for example under forceful termination — cannot produce a report.

Profiling injects a Node preload probe but does not instrument application functions or replace application-owned signal handling.

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
const timing = await benchmark("node", ["server.js"], {
  runs: 10,
  warmup: 2
});
const profile = await profileNodeProcess("node", ["worker.js"], {
  stdio: "ignore"
});
```

The package exposes documented ESM entry points and ships synchronized TypeScript declarations. Public result objects carry `schemaVersion: 1`. Configuration errors use `ConfigError` with `propertyPath`.

## Exit codes

- `0` — command completed and its gate passed.
- `1` — a budget failed or the profiled target exited unsuccessfully.
- `2` — invalid CLI usage, invalid configuration, incompatible baseline, or operational failure.

stdout contains the requested result. Errors and diagnostics use stderr. JSON and SARIF never contain ANSI color codes. Use `--no-color` for deterministic human logs.

## Compatibility and limitations

- Runtime requirement: Node.js `>=20`.
- CI verifies Node.js 20, 22, and 24 on Linux plus Node.js 22 on Windows and macOS.
- Static rules identify risk patterns, not proven slowdowns. They do not perform whole-program data flow or runtime hot-path detection.
- `async/no-await-in-loop` is contextual. Sequential iteration may be correct for ordering, rate limits, dependencies, or bounded memory; Velocity never recommends unbounded `Promise.all()` as a universal fix.
- Benchmark results depend on machine load, power state, caches, and environment. Use controlled runners and enough samples.
- The profiler covers the main Node process. Child processes write isolated data but are not aggregated.
- Velocity has no telemetry, hosted service, plugin API, or hidden uploads.
- Source rewrites happen only through explicit `optimize --apply --fix <id>` selections with scoped snapshots.

## Development

```bash
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run check
npm pack --dry-run
```

CI runs cross-platform tests, self-analysis, coverage gates, SARIF generation, and a packed-tarball smoke test.

## Release engineering

Publishing is isolated from CI in `.github/workflows/publish.yml`. Releases use npm Trusted Publishing/OIDC with provenance instead of a long-lived write token, validate the requested package version, serialize publish jobs, run the full release checks, inspect the tarball, and create the matching GitHub Release from the changelog.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## Roadmap

1. Improve binding and control-flow precision from fixture-backed false-positive reports.
2. Version documented baseline migration tooling before any schema v2 change.
3. Add statistically stronger repeated-run comparison only after cross-platform validation.
4. Consider a public rule API only after the internal rule contract remains stable across releases.

## License

MIT © WessYu
