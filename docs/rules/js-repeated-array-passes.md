# `js/repeated-array-passes`

Reports chains of three or more `filter`, `map`, `flatMap`, or `reduce` calls. Default: **info**.

Several full traversals can matter for large collections on measured hot paths. The readable chain may be preferable for ordinary collections; benchmark before fusing operations.

```js
items.filter(valid).map(format).reduce(group, {}); // finding
items.filter(valid).map(format); // no finding
```
