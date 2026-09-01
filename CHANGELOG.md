# Changelog

## 0.3.1 - 2026-08-31

### Fixed

- Report unavailable browser measurements as `null` instead of fabricating zero values.
- Rename Velocity's custom visual metric from `speedIndexMs` to `visualProgressIndexMs`; it is explicitly documented as an approximation, not Lighthouse Speed Index, and is collected in a separate navigation.
- Record the real Chromium version/major version and a user agent coherent with that browser, while keeping TLS certificate validation enabled unless `--ignore-https-errors` is explicit.
- Validate load URL, measurement protocol, browser, browser major version, device, viewport, throttling, platform, and architecture before comparison. `--allow-environment-mismatch` is explicit and always produces `inconclusive`.
- Bound build artifact work with deterministic ordering, limited concurrency, and a maximum per-artifact compression read size.
- Stop reporting synthetic gzip/Brotli sizes for already-compressed or binary assets such as PNG, JPEG, WebP, AVIF, GIF, WOFF2, video, and archives.
- Correct `maxAssetKb` to mean the largest individual artifact and add `maxTotalAssetsKb` for total emitted raw bytes.
- Use real Next.js Pages/App Router manifests for route attribution and represent unavailable route sizes as `null` instead of zero.
- Distinguish plain React projects from Create React App rather than assuming any React dependency implies CRA output semantics.
- Make intrinsic image-dimension proposals `review-required` across literal/public paths, Vite/Next-style imports, `new URL(..., import.meta.url)`, PNG, JPEG, SVG, and WebP VP8X.
- Never infer `loading="lazy"` safety from JSX source order.
- Preserve file permissions during optimization writes and rollback, verify hashes before restore, preserve concurrent edits, and create recovery artifacts when automatic rollback would overwrite external work.
- Remove `measured-fix` from the shipped optimization contract because Velocity does not include a built-in transformation with measured proof.

### Changed

- Add `--no-visual`, `--ignore-https-errors`, `--allow-environment-mismatch`, and `--max-total-assets` CLI contracts and synchronize ESM types, JSON schemas, reporters, configuration, and documentation.
- Adapter capabilities now describe only concrete measurement/manifest behavior instead of promotional optimization claims.
- CI includes a mandatory Ubuntu Chromium HTTP/HTTPS smoke and validates generated JSON against the shipped schemas.
- Release publishing validates exact package/changelog identity, registry commit identity, full checks, real Chromium behavior, dry-run versus actual tarball contents, packed package metadata, external installation, and npm `gitHead` before creating the GitHub Release.

### Compatibility

- Regenerate 0.3.0 `load` baselines before comparing with 0.3.1 because the custom visual metric name and measurement protocol were corrected.
- Build consumers must accept `gzipBytes` and `brotliBytes` as `null` when compression is not a meaningful measured value.
- Supported and CI-verified Node.js lines remain 20, 22, and 24 on Linux, with Node.js 22 additionally verified on Windows and macOS.
- Existing commands and named ESM API exports remain available.

### Safety

- Optimization rollback never overwrites a file whose current hash no longer matches Velocity's expected post-write hash; a recovery artifact is emitted instead.
- HTTPS certificate errors are never ignored implicitly.
- Environment mismatches can be inspected only through an explicit override and cannot produce a conclusive load verdict.
- Release publishing remains outside ordinary CI and uses npm Trusted Publishing/OIDC rather than a long-lived write token.

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
