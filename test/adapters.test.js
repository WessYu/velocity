import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { adapterCapabilities, adapterInsights, detectAdapter } from "../src/adapters.js";

const artifacts = [
  { file: "main.js", category: "javascript", initial: false, rawBytes: 100, brotliBytes: 50 },
  { file: "chunks/lazy.js", category: "javascript", initial: false, rawBytes: 80, brotliBytes: 40 },
  { file: "style.css", category: "css", initial: false, rawBytes: 20, brotliBytes: 10 }
];

async function fixture(manifest = null) {
  const root = await mkdtemp(path.join(tmpdir(), "velocity-adapter-"));
  if (manifest !== null) await writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("detects framework adapters by dependencies and config files with correct precedence", async () => {
  const next = await fixture({ dependencies: { next: "16", vite: "7", react: "19" } });
  const vite = await fixture({ devDependencies: { vite: "7", react: "19" } });
  const react = await fixture({ peerDependencies: { react: "19" } });
  const generic = await fixture({});
  const nextConfig = await fixture();
  const viteConfig = await fixture();
  try {
    await writeFile(path.join(nextConfig.root, "next.config.mjs"), "export default {};\n");
    await writeFile(path.join(viteConfig.root, "vite.config.ts"), "export default {};\n");
    assert.equal((await detectAdapter(next.root)).id, "next");
    assert.equal((await detectAdapter(vite.root)).id, "vite");
    assert.equal((await detectAdapter(react.root)).id, "react");
    assert.equal((await detectAdapter(generic.root)).id, "javascript");
    assert.equal((await detectAdapter(nextConfig.root)).id, "next");
    assert.equal((await detectAdapter(viteConfig.root)).id, "vite");
    assert.ok(adapterCapabilities(await detectAdapter(next.root)).capabilities.includes("routes"));
    assert.ok(adapterCapabilities(await detectAdapter(vite.root)).capabilities.includes("vite-manifest"));
    assert.equal(adapterCapabilities(await detectAdapter(generic.root)).capabilities.includes("routes"), false);
  } finally {
    await Promise.all([next, vite, react, generic, nextConfig, viteConfig].map((item) => item.cleanup()));
  }
});

test("Vite adapter falls back heuristically and follows manifest imports, css and dynamic imports", async () => {
  const item = await fixture({ dependencies: { vite: "7" } });
  try {
    const adapter = await detectAdapter(item.root);
    const output = path.join(item.root, "dist");
    await mkdir(output, { recursive: true });
    assert.deepEqual([...await adapter.initialFiles(item.root, output, artifacts)], ["main.js"]);
    await writeFile(path.join(output, "manifest.json"), JSON.stringify({
      "src/main.jsx": { file: "main.js", isEntry: true, css: ["style.css"], imports: ["shared"], dynamicImports: ["lazy"] },
      shared: { file: "chunks/shared.js" },
      lazy: { file: "chunks/lazy.js", dynamicImports: [] }
    }));
    const initial = await adapter.initialFiles(item.root, output, artifacts);
    assert.deepEqual([...initial].sort(), ["chunks/shared.js", "main.js", "style.css"]);
    const insight = await adapter.insights(item.root, output, artifacts);
    assert.equal(insight.entries.length, 1);
    assert.deepEqual(insight.entries[0].css, ["style.css"]);
    assert.deepEqual(insight.entries[0].imports, ["shared"]);
    assert.deepEqual(insight.dynamicImports, [{ source: "src/main.jsx", dependency: "lazy" }]);
    assert.equal(insight.chunks.length, 2);
  } finally { await item.cleanup(); }
});

test("Next adapter handles missing and complete manifests and computes route sizes", async () => {
  const item = await fixture({ dependencies: { next: "16" } });
  try {
    const adapter = await detectAdapter(item.root);
    const output = path.join(item.root, ".next", "static");
    await mkdir(output, { recursive: true });
    assert.deepEqual([...await adapter.initialFiles(item.root, output, artifacts)], ["main.js"]);
    await mkdir(path.join(item.root, ".next"), { recursive: true });
    await writeFile(path.join(item.root, ".next", "build-manifest.json"), JSON.stringify({
      polyfillFiles: ["static/poly.js"],
      rootMainFiles: ["static/main.js"],
      pages: { "/_app": ["static/app.js"], "/": ["/_next/static/main.js"], "/about": ["static/chunks/lazy.js", "static/missing.js"] }
    }));
    await writeFile(path.join(item.root, ".next", "app-path-routes-manifest.json"), JSON.stringify({ "app/page": "/app" }));
    const initial = await adapter.initialFiles(item.root, output, artifacts);
    assert.deepEqual([...initial].sort(), ["app.js", "main.js", "poly.js"]);
    const insight = await adapter.insights(item.root, output, artifacts);
    const about = insight.routes.find((route) => route.route === "/about");
    assert.equal(about.rawBytes, 80);
    assert.equal(about.brotliBytes, 40);
    assert.ok(insight.routes.some((route) => route.route === "/app" && route.source === "app/page"));
    assert.deepEqual(insight.entries, ["main.js"]);
  } finally { await item.cleanup(); }
});

test("React and generic adapters cover manifest and heuristic entry selection", async () => {
  const react = await fixture({ dependencies: { react: "19" } });
  const generic = await fixture({ dependencies: { leftpad: "1" } });
  try {
    const reactAdapter = await detectAdapter(react.root);
    const build = path.join(react.root, "build");
    await mkdir(build, { recursive: true });
    const fallbackArtifacts = [{ file: "vendor.js", category: "javascript", initial: false, rawBytes: 1, brotliBytes: 1 }, { file: "chunks/nested.js", category: "javascript", initial: false, rawBytes: 1, brotliBytes: 1 }];
    assert.deepEqual([...await reactAdapter.initialFiles(react.root, build, fallbackArtifacts)], ["vendor.js"]);
    await writeFile(path.join(build, "asset-manifest.json"), JSON.stringify({ entrypoints: ["/main.js", "/style.css"] }));
    assert.deepEqual([...await reactAdapter.initialFiles(react.root, build, artifacts)], ["main.js", "style.css"]);
    const reactInsight = await reactAdapter.insights(react.root, build, artifacts);
    assert.deepEqual(reactInsight.entries, ["/main.js", "/style.css"]);

    const genericAdapter = await detectAdapter(generic.root);
    assert.deepEqual([...await genericAdapter.initialFiles(generic.root, path.join(generic.root, "dist"), artifacts)], ["main.js"]);
    const genericInsight = await genericAdapter.insights(generic.root, path.join(generic.root, "dist"), artifacts);
    assert.equal(genericInsight.chunks.length, 2);

    const enriched = await adapterInsights({ ...genericAdapter, manifest: { dependencies: { zeta: "2" }, devDependencies: { alpha: "1" } } }, generic.root, path.join(generic.root, "dist"), artifacts);
    assert.deepEqual(enriched.dependencies, [{ name: "alpha", version: "1" }, { name: "zeta", version: "2" }]);
  } finally { await Promise.all([react.cleanup(), generic.cleanup()]); }
});

test("invalid package and manifest JSON degrade safely to the generic heuristics", async () => {
  const item = await fixture();
  try {
    await writeFile(path.join(item.root, "package.json"), "{");
    const adapter = await detectAdapter(item.root);
    assert.equal(adapter.id, "javascript");
    const output = path.join(item.root, "dist");
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "manifest.json"), "{");
    assert.deepEqual([...await adapter.initialFiles(item.root, output, artifacts)], ["main.js"]);
  } finally { await item.cleanup(); }
});
