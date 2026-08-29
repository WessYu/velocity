# Rule catalog

Rules are parser-backed and run independently of the CLI and reporters. Default severities are budgets, not claims that every finding is slow in every context.

| Rule | Default | Category |
| --- | --- | --- |
| [`node/no-blocking-fs`](node-no-blocking-fs.md) | error | Node.js |
| [`node/no-sync-process`](node-no-sync-process.md) | error | Node.js |
| [`async/no-await-in-loop`](async-no-await-in-loop.md) | warning | Async |
| [`browser/no-dom-query-in-loop`](browser-no-dom-query-in-loop.md) | warning | Browser |
| [`js/repeated-array-passes`](js-repeated-array-passes.md) | info | JavaScript |
| [`runtime/track-interval`](runtime-track-interval.md) | warning | Runtime |
| [`project/large-source-file`](project-large-source-file.md) | warning | Project |
| [`velocity/invalid-suppression`](velocity-invalid-suppression.md) | warning | Governance |
| [`velocity/unused-suppression`](velocity-unused-suppression.md) | info | Governance |
