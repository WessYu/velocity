import { access, readFile } from "node:fs/promises";
import path from "node:path";

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function readJson(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } }

function dependencies(manifest) {
  return { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
}

const viteAdapter = {
  id: "vite",
  name: "Vite",
  outputDirectory: "dist",
  async initialFiles(root, outputDirectory, artifacts) {
    const manifest = await readJson(path.join(outputDirectory, ".vite", "manifest.json")) ?? await readJson(path.join(outputDirectory, "manifest.json"));
    if (!manifest) return heuristicInitial(artifacts);
    const initial = new Set();
    const visit = (key) => {
      const entry = manifest[key];
      if (!entry || initial.has(entry.file)) return;
      if (entry.file) initial.add(entry.file);
      for (const css of entry.css ?? []) initial.add(css);
      for (const dependency of entry.imports ?? []) visit(dependency);
    };
    for (const [key, entry] of Object.entries(manifest)) if (entry.isEntry) visit(key);
    return initial;
  },
  async insights(root, outputDirectory, artifacts) {
    const manifest = await readJson(path.join(outputDirectory, ".vite", "manifest.json")) ?? await readJson(path.join(outputDirectory, "manifest.json"));
    const entries = Object.entries(manifest ?? {});
    return {
      routes: [],
      entries: entries.filter(([, value]) => value.isEntry).map(([source, value]) => ({ source, file: value.file, css: value.css ?? [], imports: value.imports ?? [] })),
      dynamicImports: entries.flatMap(([source, value]) => (value.dynamicImports ?? []).map((dependency) => ({ source, dependency }))),
      chunks: artifacts.filter((artifact) => artifact.category === "javascript").map((artifact) => ({ file: artifact.file, initial: artifact.initial, rawBytes: artifact.rawBytes, brotliBytes: artifact.brotliBytes }))
    };
  }
};

const nextAdapter = {
  id: "next",
  name: "Next.js",
  outputDirectory: path.join(".next", "static"),
  async initialFiles(root, outputDirectory, artifacts) {
    const manifest = await readJson(path.join(root, ".next", "build-manifest.json"));
    if (!manifest) return heuristicInitial(artifacts);
    const values = [...(manifest.polyfillFiles ?? []), ...(manifest.rootMainFiles ?? []), ...(manifest.pages?.["/_app"] ?? []), ...(manifest.pages?.["/"] ?? [])];
    return new Set(values.map((file) => file.replace(/^\/?(?:_next\/)?static\//, "")));
  },
  async insights(root, outputDirectory, artifacts) {
    const buildManifest = await readJson(path.join(root, ".next", "build-manifest.json")) ?? {};
    const appRoutes = await readJson(path.join(root, ".next", "app-path-routes-manifest.json")) ?? {};
    const pages = buildManifest.pages ?? {};
    const byFile = new Map(artifacts.map((artifact) => [artifact.file, artifact]));
    const normalize = (file) => file.replace(/^\/?(?:_next\/)?static\//, "");
    return {
      routes: [
        ...Object.entries(pages).map(([route, files]) => {
        const normalized = [...new Set(files.map(normalize))];
        const routeArtifacts = normalized.map((file) => byFile.get(file)).filter(Boolean);
        return { route, files: normalized, rawBytes: routeArtifacts.reduce((sum, artifact) => sum + artifact.rawBytes, 0), brotliBytes: routeArtifacts.reduce((sum, artifact) => sum + artifact.brotliBytes, 0) };
        }),
        ...Object.entries(appRoutes).map(([source, route]) => ({ route, source, files: [], rawBytes: 0, brotliBytes: 0 }))
      ],
      entries: (buildManifest.rootMainFiles ?? []).map(normalize),
      dynamicImports: [],
      chunks: artifacts.filter((artifact) => artifact.category === "javascript").map((artifact) => ({ file: artifact.file, initial: artifact.initial, rawBytes: artifact.rawBytes, brotliBytes: artifact.brotliBytes }))
    };
  }
};

const reactAdapter = {
  id: "react",
  name: "React",
  outputDirectory: "build",
  async initialFiles(root, outputDirectory, artifacts) {
    const manifest = await readJson(path.join(outputDirectory, "asset-manifest.json"));
    if (!manifest) return heuristicInitial(artifacts);
    return new Set(Object.values(manifest.entrypoints ?? []).map((file) => file.replace(/^\//, "")));
  },
  async insights(root, outputDirectory, artifacts) {
    const manifest = await readJson(path.join(outputDirectory, "asset-manifest.json")) ?? {};
    return { routes: [], entries: manifest.entrypoints ?? [], dynamicImports: [], chunks: artifacts.filter((artifact) => artifact.category === "javascript").map((artifact) => ({ file: artifact.file, initial: artifact.initial, rawBytes: artifact.rawBytes, brotliBytes: artifact.brotliBytes })) };
  }
};

const genericAdapter = {
  id: "javascript",
  name: "JavaScript",
  outputDirectory: "dist",
  async initialFiles(root, outputDirectory, artifacts) { return heuristicInitial(artifacts); },
  async insights(root, outputDirectory, artifacts) { return { routes: [], entries: [], dynamicImports: [], chunks: artifacts.filter((artifact) => artifact.category === "javascript").map((artifact) => ({ file: artifact.file, initial: artifact.initial, rawBytes: artifact.rawBytes, brotliBytes: artifact.brotliBytes })) }; }
};

function heuristicInitial(artifacts) {
  const candidates = artifacts.filter((item) => item.category === "javascript" && /(?:^|\/)(?:index|main|app|entry)[.-]/i.test(item.file));
  return new Set((candidates.length ? candidates : artifacts.filter((item) => item.category === "javascript" && !item.file.includes("/"))).map((item) => item.file));
}

export async function detectAdapter(root) {
  const manifest = await readJson(path.join(root, "package.json")) ?? {};
  const packages = dependencies(manifest);
  if (packages.next || await exists(path.join(root, "next.config.js")) || await exists(path.join(root, "next.config.mjs"))) return { ...nextAdapter, manifest };
  if (packages.vite || await exists(path.join(root, "vite.config.js")) || await exists(path.join(root, "vite.config.ts"))) return { ...viteAdapter, manifest };
  if (packages.react) return { ...reactAdapter, manifest };
  return { ...genericAdapter, manifest };
}

export function adapterCapabilities(adapter) {
  const common = ["bundles", "imports", "lazy-loading", "images", "fonts", "scripts", "chunks", "dependencies"];
  return { adapter: adapter.id, capabilities: adapter.id === "next" ? [...common, "routes", "next-image", "next-font", "server-client-boundaries"] : adapter.id === "vite" ? [...common, "vite-manifest", "dynamic-imports"] : common };
}

export async function adapterInsights(adapter, root, outputDirectory, artifacts) {
  const insight = await adapter.insights(root, outputDirectory, artifacts);
  const packageDependencies = dependencies(adapter.manifest);
  return { ...insight, dependencies: Object.keys(packageDependencies).sort().map((name) => ({ name, version: packageDependencies[name] })) };
}
