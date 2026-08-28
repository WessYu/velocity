import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const extensions = new Set([".js", ".cjs", ".mjs"]);
const roots = ["bin", "src", "scripts"];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  // velocity-ignore-next-line async/no-await-in-loop -- development-only directory traversal
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(target));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(target);
  }

  return files;
}

const files = (await Promise.all(roots.map(collect))).flat().sort();

for (const file of files) {
  // velocity-ignore-next-line node/no-sync-process -- ordered development-time syntax validation
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    shell: false
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exitCode = result.status ?? 1;
    break;
  }
}

if (!process.exitCode) console.log(`Syntax verified in ${files.length} files.`);
