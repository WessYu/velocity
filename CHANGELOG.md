# Changelog

## 0.3.0 - Unreleased

### Added

- Real React, Vite, and Next.js adapters with manifest-aware bundle, chunk, route, dependency, image, font, script, and asset analysis.
- `build` reports raw, gzip, and Brotli sizes with saved comparisons and bundle budgets.
- `load` measures FCP, LCP, CLS, TBT, Speed Index, TTFB, requests, and bytes in Chromium across mobile or desktop runs.
- Default-dry-run `optimize` plans with classified evidence, impact, risk, affected files, patches, and explicit per-fix authorization.
- Scoped snapshots, build/typecheck/test validation, precise rollback, measured-fix noise margins, and `verify` result classification.
- Complete React + Vite and Next.js fixtures and packaged-tarball integration coverage.

### Changed

- Test discovery now runs only Velocity's top-level test files, so generated fixture bundles cannot be executed accidentally by Node's test runner.
- Package smoke tests derive the expected CLI version from `package.json` instead of duplicating a release number in CI.
- Generated Vite and Next.js fixture outputs are no longer tracked and every CLI build test creates the artifacts it needs.
- Native image optimization auto-applies only evidence-backed intrinsic dimensions. Missing lazy-loading policy is reported for review; JSX source order alone is never treated as proof that an image is below the initial viewport.
- Node profiling records signal termination without replacing application-owned `SIGINT` or `SIGTERM` handlers.

### Safety

- Optimization never uses destructive Git commands and never overwrites unrelated user changes.
- Lazy-loading is not auto-applied from source order because an incorrect `loading="lazy"` decision can delay an initially visible or LCP image.
- TBT remains explicitly identified as a lab metric and is never labeled as INP.

## 0.2.0 - Unreleased

### Added

- Babel AST analysis for JavaScript, TypeScript, JSX, TSX, ESM, and CommonJS.
- Lexical binding checks, stable fingerprints, strict suppressions, resolved-config and rule-catalog commands.
- Versioned JSON and SARIF 2.1.0 output.
- Environment-aware benchmark statistics and isolated main-process profiling.
- TypeScript declarations, schemas, coverage gates, cross-platform CI, and tarball smoke tests.

### Changed

- Canonical package identity is now `@wess2001/velocity`.
- Health score is explicitly heuristic and versioned as formula v1.
- Benchmark comparison rejects different commands and environments by default.
- CLI usage/configuration errors use exit code 2; budget failures use exit code 1.

### Compatibility

- Existing named API exports and core commands remain available.
- Benchmark baselines now require `schemaVersion: 1` and environment metadata. Older 0.1.x benchmark files must be regenerated.
