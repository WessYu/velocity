import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "..");
export const fixtureRoot = (name) => path.join(import.meta.dirname, "fixtures", name);

export async function temporaryFixture(name) {
  const temporary = await mkdtemp(path.join(repositoryRoot, `.velocity-${name}-`));
  await cp(fixtureRoot(name), temporary, { recursive: true, filter: (source) => !/[\\/](?:dist|\.next)(?:[\\/]|$)/.test(source) });
  const packageFile = path.join(temporary, "package.json");
  const manifest = JSON.parse(await readFile(packageFile, "utf8"));
  const executable = (relative) => `../node_modules/${relative}`;
  if (name === "vite-app") manifest.scripts.build = `node "${executable("vite/bin/vite.js")}" build`;
  if (name === "next-app") manifest.scripts.build = `node "${executable("next/dist/bin/next")}" build --webpack`;
  manifest.scripts.typecheck = `node "${executable("typescript/bin/tsc")}" --noEmit --allowJs --checkJs --jsx react-jsx --module NodeNext --moduleResolution NodeNext --target ES2022 ${name === "vite-app" ? "src/main.jsx src/App.jsx" : "app/layout.jsx app/page.jsx"}`;
  await writeFile(packageFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { directory: temporary, cleanup: () => rm(temporary, { recursive: true, force: true }) };
}
