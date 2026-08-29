# `async/no-await-in-loop`

Reports `await` directly controlled by a loop. Default: **warning**.

The pattern may serialize independent operations. It is not inherently wrong: ordering, dependencies, rate limits, backpressure, and memory limits commonly require sequential or bounded work. Prefer an explicit concurrency limiter when independence is proven; do not replace it with unbounded `Promise.all()` automatically.

```js
for (const id of ids) await load(id); // contextual finding

for (const page of pages) {
  cursor = await loadNext(cursor); // may be intentionally dependent
}
```
