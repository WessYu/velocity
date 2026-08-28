import { access, readFile } from "node:fs/promises";
import path from "node:path";

const frameworkPackages = new Map([
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["nuxt", "Nuxt"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["hono", "Hono"],
  ["@nestjs/core", "NestJS"]
]);

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function detectProject(root, files) {
  const directory = root;
  const packagePath = path.join(directory, "package.json");
  let manifest = {};

  if (await exists(packagePath)) {
    try {
      manifest = JSON.parse(await readFile(packagePath, "utf8"));
    } catch {
      manifest = {};
    }
  }

  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const frameworks = [...frameworkPackages]
    .filter(([packageName]) => packageName in dependencies)
    .map(([, framework]) => framework);
  const packageManagers = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"]
  ];
  const lockfilePresence = await Promise.all(packageManagers.map(([lockfile]) => exists(path.join(directory, lockfile))));
  const packageManagerIndex = lockfilePresence.findIndex(Boolean);
  const packageManager = packageManagerIndex === -1 ? null : packageManagers[packageManagerIndex][1];

  const usesTypeScript = files.some((file) => !file.endsWith(".d.ts") && /\.(?:ts|tsx|mts|cts)$/.test(file));
  return {
    name: manifest.name ?? path.basename(directory),
    moduleType: manifest.type ?? "commonjs",
    language: usesTypeScript ? "TypeScript" : "JavaScript",
    packageManager,
    frameworks
  };
}
