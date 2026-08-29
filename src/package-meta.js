import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

export const packageName = manifest.name;
export const packageVersion = manifest.version;
