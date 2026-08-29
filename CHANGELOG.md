# Changelog

## 0.3.0 - 2026-08-29

### Added

- Babel AST analysis for JavaScript, TypeScript, JSX, TSX, ESM, and CommonJS with lexical binding checks and stable finding fingerprints.
- Strict suppression governance, resolved configuration output, a rule catalog, versioned JSON, and SARIF 2.1.0 output.
- Environment-aware command benchmarks with median, p95, standard deviation, coefficient of variation, and explicit instability reporting.
- Isolated main-process Node.js profiling for CPU, memory, event-loop utilization, event-loop delay, exit codes, and termination signals.
- Real React, Vite, and Next.js adapters with manifest-aware bundle, chunk, route, dependency, image, font, script, and asset analysis.
- `build` reports raw, gzip, and Brotli sizes with saved comparisons and bundle budgets.
- `load` measures FCP, LCP, CLS, TBT, Speed Index, TTFB, requests, and bytes in Chromium across mobile or desktop runs.
- Default-dry-run `optimize` plans with classified evidence, impact, risk, affected files, patches, and explicit per-fix authorization.
- Scoped snapshots, build/typecheck/test validation, precise rollback, measured-fix noise margins, and `verify` result classification.
- TypeScript declarations, schemas, fixture-backed integration tests, cross-platform CI, coverage gates, self-analysis, and packaged-tarball smoke tests.

### Changed

- Canonical package identity is `@wess2001/velocity`.
- Health score is explicitly heuristic and versioned as formula v1.
- Benchmark comparison rejects different commands and environments by default unless environment mismatch is explicitly allowed.
- CLI usage and configuration errors use exit code 2; budget failures use exit code 1.
- Test discovery runs only Velocity's top-level test files, so generated fixture bundles cannot be executed accidentally by Node's test runner.
- Package smoke tests derive the expected CLI version from `package.json` instead of duplicating a release number in CI.
- Vite and Next.js fixture builds are isolated per test worker to prevent generated-output races across Node and operating-system jobs.
- Native image optimization auto-applies only evidence-backed intrinsic dimensions. Missing lazy-loading policy is reported for review; JSX source order alone is never treated as proof that an image is below the initial viewport.
- Node profiling records signal termination without replacing application-owned `SIGINT` or `SIGTERM` handlers.

### Compatibility

- Supported and CI-verified Node.js lines: 20, 22, and 24 on Linux, Windows, and macOS.
- Existing named API exports and core commands remain available.
- Benchmark baselines use `schemaVersion: 1` and include environment metadata. Older 0.1.x benchmark files should be regenerated before comparison.

### Safety

- Optimization never uses destructive Git commands and never overwrites unrelated user changes.
- Every applied optimization requires an explicit optimization ID and a reviewable patch.
- Lazy-loading is not auto-applied from source order because an incorrect `loading="lazy"` decision can delay an initially visible or LCP image.
- TBT remains explicitly identified as a lab metric and is never labeled as INP.
- Release publishing is kept outside the test pipeline and is designed for npm Trusted Publishing with short-lived OIDC credentials.
