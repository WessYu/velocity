import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

export async function discoverSourceFiles(root, ignore) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".well-known") continue;
      if (ignore.includes(entry.name)) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(absolutePath);
      }
    }
  }

  const rootStats = await stat(root);
  if (rootStats.isFile()) return SOURCE_EXTENSIONS.has(path.extname(root)) ? [root] : [];
  await visit(root);
  return files.sort();
}

export async function loadSource(file) {
  const [source, metadata] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  return { source, bytes: metadata.size };
}
