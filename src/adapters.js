import { access, readFile } from "node:fs/promises";
import path from "node:path";

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function readJson(file) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; } }

function dependencies(manifest) {
  return { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
}

function normalizeNextFile(file) { return file.replace(/^\/?(?:_next\/)?static\//, ""); }
function routeMeasurement(files, byFile) {
  if (!Array.isArray(files) || !files.length) return { files: [], rawBytes: null, brotliBytes: null, available: false };
  const normalized = [...new Set(files.map(normalizeNextFile))];
  const routeArtifacts = normalized.map((file) => byFile.get(file));
  if (routeArtifacts.some((artifact) => !artifact)) return { files: normalized, rawBytes: null, brotliBytes: null, available: false };
  const rawBytes = routeArtifacts.reduce((sum, artifact) => sum + artifact.rawBytes, 0);
  const brotliBytes = routeArtifacts.every((artifact) => Number.isFinite(artifact.brotliBytes)) ? routeArtifacts.reduce((sum, artifact) => sum + artifact.brotliBytes, 0) : null;
  return { files: normalized, rawBytes, brotliBytes, available: true };
}

const viteAdapter = {
  id: "vite",
  name: "Vite",
  outputDirectory: "dist",
  detection: "package/config",
  initialFileSource: "vite-manifest-or-heuristic",
  async initialFiles(root, outputDirectory, artifacts) {
    const manifest = await readJson(path.join(outputDirectory, ".vite", "manifest.json")) ?? await readJson(path.join(outputDirectory, "manifest.json"));
    if (!manifest) return heuristicInitial(artifacts);
    const initial = new Set();
    const visit = (key) => {
      const entry = manifest[key];
      if (!entry || (entry.file && initial.has(entry.file))) return;
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
  detection: "package/config",
  initialFileSource: "next-manifests",
  async initialFiles(root) {
    const buildManifest = await readJson(path.join(root, ".next", "build-manifest.json"));
    const appBuildManifest = await readJson(path.join(root, ".next", "app-build-manifest.json"));
    if (!buildManifest && !appBuildManifest) return new Set();
    const values = [
      ...(buildManifest?.polyfillFiles ?? []),
      ...(buildManifest?.rootMainFiles ?? []),
      ...(buildManifest?.pages?.["/_app"] ?? []),
      ...(buildManifest?.pages?.["/"] ?? []),
      ...Object.values(appBuildManifest?.pages ?? {}).flat()
    ];
    return new Set(values.map(normalizeNextFile));
  },
  async insights(root, outputDirectory, artifacts) {
    const buildManifest = await readJson(path.join(root, ".next", "build-manifest.json"));
    const appBuildManifest = await readJson(path.join(root, ".next", "app-build-manifest.json"));
    const appRoutes = await readJson(path.join(root, ".next", "app-path-routes-manifest.json"));
    const pages = buildManifest?.pages ?? {};
    const appPages = appBuildManifest?.pages ?? {};
    const byFile = new Map(artifacts.map((artifact) => [artifact.file, artifact]));
    const pageRoutes = Object.entries(pages).map(([route, files]) => ({ route, router: "pages", ...routeMeasurement(files, byFile) }));
    const appRouteEntries = Object.entries(appRoutes ?? {}).map(([source, route]) => {
      const candidates = [source, source.startsWith("/") ? source : `/${source}`, route];
      const files = candidates.map((candidate) => appPages[candidate]).find(Array.isArray) ?? null;
      return { route, source, router: "app", ...routeMeasurement(files, byFile) };
    });
    const knownSources = new Set(appRouteEntries.map((entry) => entry.source));
    for (const [source, files] of Object.entries(appPages)) {
      if (knownSources.has(source)) continue;
      appRouteEntries.push({ route: null, source, router: "app", ...routeMeasurement(files, byFile) });
    }
    return {
      routes: [...pageRoutes, ...appRouteEntries],
      entries: (buildManifest?.rootMainFiles ?? []).map(normalizeNextFile),
      dynamicImports: [],
      manifestAvailability: { buildManifest: Boolean(buildManifest), appBuildManifest: Boolean(appBuildManifest), appPathRoutesManifest: Boolean(appRoutes) },
      chunks: artifacts.filter((artifact) => artifact.category === "javascript").map((artifact) => ({ file: artifact.file, initial: artifact.initial, rawBytes: artifact.rawBytes, brotliBytes: artifact.brotliBytes }))
    };
  }
};

const craAdapter = {
  id: "cra",
  name: "Create React App",
  outputDirectory: "build",
  detection: "react-scripts",
  initialFileSource: "asset-manifest-or-heuristic",
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

const reactAdapter = {
  id: "react",
  name: "React",
  outputDirectory: "dist",
  detection: "react-package",
  initialFileSource: "heuristic",
  async initialFiles(root, outputDirectory, artifacts) { return heuristicInitial(artifacts); },
  async insights(root, outputDirectory, artifacts) { return { routes: [], entries: [], dynamicImports: [], chunks: artifacts.filter((artifact) => artifact.category === "javascript").map((artifact) => ({ file: artifact.file, initial: artifact.initial, rawBytes: artifact.rawBytes, brotliBytes: artifact.brotliBytes })) }; }
};

const genericAdapter = {
  id: "javascript",
  name: "JavaScript",
  outputDirectory: "dist",
  detection: "fallback",
  initialFileSource: "heuristic",
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
  if (packages.next || await exists(path.join(root, "next.config.js")) || await exists(path.join(root, "next.config.mjs")) || await exists(path.join(root, "next.config.ts"))) return { ...nextAdapter, manifest };
  if (packages.vite || await exists(path.join(root, "vite.config.js")) || await exists(path.join(root, "vite.config.ts")) || await exists(path.join(root, "vite.config.mjs"))) return { ...viteAdapter, manifest };
  if (packages["react-scripts"]) return { ...craAdapter, manifest };
  if (packages.react) return { ...reactAdapter, manifest };
  return { ...genericAdapter, manifest };
}

export function adapterCapabilities(adapter) {
  const capabilities = ["artifact-sizes"];
  if (adapter.id === "next") capabilities.push("next-manifests", "route-attribution");
  if (adapter.id === "vite") capabilities.push("vite-manifest", "dynamic-import-edges");
  if (adapter.id === "cra") capabilities.push("asset-manifest");
  return { adapter: adapter.id, detection: adapter.detection, initialFileSource: adapter.initialFileSource, capabilities };
}

export async function adapterInsights(adapter, root, outputDirectory, artifacts) {
  const insight = await adapter.insights(root, outputDirectory, artifacts);
  const packageDependencies = dependencies(adapter.manifest);
  return { ...insight, dependencies: Object.keys(packageDependencies).sort().map((name) => ({ name, version: packageDependencies[name] })) };
}
