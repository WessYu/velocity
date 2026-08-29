# `node/no-blocking-fs`

Reports synchronous functions bound to `fs` or `node:fs`. Default: **error**.

Synchronous disk I/O blocks the Node.js event loop until completion. Use the matching asynchronous API on concurrent paths. Startup, shutdown, and short CLI operations can be intentional; measure their impact or add a justified local suppression.

```js
import { readFileSync } from "node:fs";
readFileSync("config.json"); // finding

function readFileSync() {}
readFileSync(); // no finding: user-owned symbol
```
