import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fixture renders its measured heading", async () => {
  assert.match(await readFile(new URL("../app/page.jsx", import.meta.url), "utf8"), /Measured Next\.js application/);
});
