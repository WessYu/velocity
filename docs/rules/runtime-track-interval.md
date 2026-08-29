# `runtime/track-interval`

Reports unshadowed global `setInterval` calls whose returned handle is discarded. Default: **warning**.

Discarding the handle prevents direct cleanup with `clearInterval` and can retain resources during teardown.

```js
setInterval(refresh, 1000); // finding
const timer = setInterval(refresh, 1000); // no finding
```
