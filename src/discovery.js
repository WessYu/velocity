import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

function regexEscape(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
function globRegex(pattern) {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index] === "*" && normalized[index + 1] === "*" && normalized[index + 2] === "/") { expression += "(?:.*/)?"; index += 2; }
    else if (normalized[index] === "*" && normalized[index + 1] === "*") { expression += ".*"; index += 1; }
    else if (normalized[index] === "*") expression += "[^/]*";
    else if (normalized[index] === "?") expression += "[^/]";
    else expression += regexEscape(normalized[index]);
  }
  return new RegExp(`(?:^|/)${expression}(?:/|$)`);
}

export function createIgnoreMatcher(patterns) {
  const regexes = patterns.map(globRegex);
  return (relativePath) => regexes.some((regex) => regex.test(relativePath.replaceAll("\\", "/")));
}

export async function discoverSourceFiles(root, ignore = []) {
  const files = [];
  const errors = [];
  const isIgnored = createIgnoreMatcher(ignore);
  const rootStats = await stat(root);
  if (rootStats.isFile()) return { files: extensions.has(path.extname(root).toLowerCase()) ? [root] : [], errors };
  const directories = [root];
  let cursor = 0;
  while (cursor < directories.length) {
    const batch = directories.slice(cursor, cursor + 16);
    cursor += batch.length;
    // velocity-ignore-next-line async/no-await-in-loop -- each bounded batch must finish before the dynamically discovered next batch
    const groups = await Promise.all(batch.map(async (directory) => {
      try { return { directory, entries: await readdir(directory, { withFileTypes: true }) }; }
      catch (error) { errors.push({ path: directory, message: error.message }); return { directory, entries: [] }; }
    }));
    for (const { directory, entries } of groups) {
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        const relative = path.relative(root, absolute);
        if (isIgnored(relative) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) directories.push(absolute);
        else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
      }
    }
  }
  return { files: files.sort((a, b) => a.localeCompare(b)), errors };
}

export async function loadSource(file) {
  const [source, metadata] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  return { source, bytes: metadata.size };
}
