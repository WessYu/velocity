import { findMatches, lineAt } from "./helpers.js";

const blockingFs = {
  id: "node/no-blocking-fs",
  title: "Synchronous filesystem operation",
  analyze(source) {
    return findMatches(
      source,
      /\b(?:fs\.)?(readFileSync|writeFileSync|appendFileSync|readdirSync|statSync|mkdirSync|rmSync)\s*\(/g,
      ([, operation]) => ({
        severity: "error",
        message: `${operation} blocks the Node.js event loop.`,
        suggestion: "Use the equivalent API from node:fs/promises and await it."
      })
    );
  }
};

const blockingProcess = {
  id: "node/no-sync-process",
  title: "Synchronous child process",
  analyze(source) {
    return findMatches(source, /\b(execFileSync|execSync|spawnSync)\s*\(/g, ([, operation]) => ({
      severity: "error",
      message: `${operation} blocks the event loop until the process exits.`,
      suggestion: "Use spawn or execFile asynchronously for request-time work."
    }));
  }
};

const awaitInLoop = {
  id: "async/no-await-in-loop",
  title: "Sequential asynchronous loop",
  analyze(source) {
    return findMatches(
      source,
      /\b(?:for\s*\([^)]*\)|for\s+await\s*\([^)]*\)|while\s*\([^)]*\))\s*\{[^{}]{0,600}?\bawait\b/gs,
      () => ({
        severity: "warning",
        message: "Await inside a loop may serialize independent operations.",
        suggestion: "When iterations are independent, map them to promises and use Promise.all with a concurrency limit."
      })
    );
  }
};

const repeatedDomQuery = {
  id: "browser/no-dom-query-in-loop",
  title: "DOM query inside a loop",
  analyze(source) {
    return findMatches(
      source,
      /\b(?:for|while)\s*\([^)]*\)\s*\{[^{}]{0,600}?document\.(?:querySelector|querySelectorAll|getElementById)\s*\(/gs,
      () => ({
        severity: "warning",
        message: "A DOM lookup is repeated on every loop iteration.",
        suggestion: "Resolve stable DOM references once before entering the loop."
      })
    );
  }
};

const repeatedArrayPasses = {
  id: "js/repeated-array-passes",
  title: "Repeated array traversal",
  analyze(source) {
    return findMatches(
      source,
      /\.(?:filter|map)\s*\([^;\n]{0,300}?\)\s*\.(?:filter|map|reduce)\s*\([^;\n]{0,300}?\)\s*\.(?:filter|map|reduce)\s*\(/g,
      () => ({
        severity: "info",
        message: "This chain traverses the collection at least three times.",
        suggestion: "For large or hot-path collections, consider a single reduce or loop and benchmark both versions."
      })
    );
  }
};

const intervalCleanup = {
  id: "runtime/track-interval",
  title: "Untracked interval",
  analyze(source) {
    const issues = [];
    for (const match of source.matchAll(/\bsetInterval\s*\(/g)) {
      const lineStart = source.lastIndexOf("\n", match.index) + 1;
      const prefix = source.slice(lineStart, match.index);
      if (prefix.includes("=") || /\breturn\s*$/.test(prefix)) continue;
      issues.push({
        severity: "warning",
        line: lineAt(source, match.index),
        message: "This interval is not assigned to a handle and may be impossible to clean up.",
        suggestion: "Store the returned handle and call clearInterval during teardown."
      });
    }
    return issues;
  }
};

export const coreRules = [blockingFs, blockingProcess, awaitInLoop, repeatedDomQuery, repeatedArrayPasses, intervalCleanup];
