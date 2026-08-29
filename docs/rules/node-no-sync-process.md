# `node/no-sync-process`

Reports `execSync`, `execFileSync`, and `spawnSync` bound to `child_process` or `node:child_process`. Default: **error**.

These calls block the event loop until the child exits. Prefer asynchronous `spawn` or `execFile` on concurrent paths. Ordered build tooling may suppress a measured, reviewed case.

```js
import { execSync as run } from "node:child_process";
run("git status"); // finding

function execSync() {}
execSync(); // no finding
```
