# `browser/no-dom-query-in-loop`

Reports global `document` queries executed inside loops. Default: **warning**.

Repeated selector resolution can add work in browser hot paths. Hoist the lookup only when the DOM remains stable during iteration. A function parameter named `document` is not treated as the browser global.

```js
for (const id of ids) document.getElementById(id); // finding

const root = document.querySelector("main");
for (const item of items) root.append(item); // no finding
```
