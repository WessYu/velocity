# Security policy

## Supported versions

Security fixes are provided for the latest published minor release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for `WessYu/velocity` and include affected versions, reproduction steps, impact, and any suggested mitigation. Maintainers should acknowledge a complete report within seven days.

Velocity runs project source parsing and user-selected commands locally. It does not use `shell: true`, send telemetry, upload source, or contact a hosted Velocity service. Benchmark and profile commands intentionally execute the exact command supplied by the user and should therefore only run against trusted project scripts.
