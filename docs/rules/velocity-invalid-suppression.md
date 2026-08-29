# `velocity/invalid-suppression`

Reports malformed directives, unknown rule IDs, and missing justifications. Default: **warning**.

```js
// velocity-ignore-next-line node/no-blocking-fs -- synchronous exit hook cannot await
fs.writeFileSync(file, data); // valid

// velocity-ignore-next-line node/no-blocking-fs
fs.writeFileSync(file, data); // invalid: no justification
```
