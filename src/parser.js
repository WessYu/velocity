import { parse } from "@babel/parser";
import path from "node:path";

export class ParseError extends Error {
  constructor(file, error) {
    const location = error.loc ? `:${error.loc.line}:${error.loc.column + 1}` : "";
    super(`Could not parse ${file}${location}: ${error.message}`);
    this.name = "ParseError";
    this.file = file;
    this.line = error.loc?.line ?? null;
    this.column = error.loc ? error.loc.column + 1 : null;
    this.cause = error;
  }
}

/** Parser boundary used by the analysis engine. */
export function parseSource(source, file) {
  const extension = path.extname(file).toLowerCase();
  /** @type {any[]} */
  const plugins = ["importAttributes", "explicitResourceManagement"];
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) plugins.push(file.endsWith(".d.ts") ? ["typescript", { dts: true }] : "typescript");
  if ([".jsx", ".tsx"].includes(extension)) plugins.push("jsx");

  try {
    return parse(source, {
      sourceType: "unambiguous",
      sourceFilename: file,
      plugins,
      allowAwaitOutsideFunction: true,
      errorRecovery: false,
      ranges: true,
      attachComment: true
    });
  } catch (error) {
    throw new ParseError(file, error);
  }
}
