# Changelog

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
