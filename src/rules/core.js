import { isFunction, location, nearestFunctionName, propertyName, walk } from "../ast.js";

const loops = new Set(["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]);
const fsModules = new Set(["fs", "node:fs"]);
const processModules = new Set(["child_process", "node:child_process"]);

function inLoop(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    if (isFunction(ancestors[index])) return false;
    if (loops.has(ancestors[index].type)) return true;
  }
  return false;
}

function moduleCall(context, node, modules, methods) {
  if (node.type !== "CallExpression") return null;
  if (node.callee.type === "Identifier") {
    const binding = context.bindings.resolve(node, node.callee.name);
    return binding?.kind === "module" && modules.has(binding.module) && methods.has(binding.imported) ? binding.imported : null;
  }
  if (node.callee.type === "MemberExpression" && node.callee.object.type === "Identifier") {
    const binding = context.bindings.resolve(node, node.callee.object.name);
    const method = propertyName(node.callee);
    return binding?.kind === "module" && binding.imported === "*" && modules.has(binding.module) && methods.has(method) ? method : null;
  }
  return null;
}

function finding(node, ancestors, values) {
  return { ...location(node), symbol: `${nearestFunctionName(ancestors)}:${values.operation ?? node.type}`, ...values };
}

const blockingFsMethods = new Set([
  "accessSync", "appendFileSync", "chmodSync", "chownSync", "closeSync", "copyFileSync", "cpSync", "existsSync",
  "fchmodSync", "fchownSync", "fdatasyncSync", "fstatSync", "fsyncSync", "ftruncateSync", "futimesSync", "globSync",
  "lchmodSync", "lchownSync", "linkSync", "lstatSync", "lutimesSync", "mkdirSync", "mkdtempSync", "openSync",
  "readFileSync", "readdirSync", "readlinkSync", "readSync", "readvSync", "realpathSync", "renameSync", "rmSync",
  "rmdirSync", "statSync", "statfsSync", "symlinkSync", "truncateSync", "unlinkSync", "utimesSync", "writeFileSync",
  "writeSync", "writevSync"
]);

const blockingFs = {
  id: "node/no-blocking-fs", title: "Synchronous filesystem operation", category: "node", defaultSeverity: "error",
  description: "Reports synchronous calls imported from node:fs or fs.",
  rationale: "Synchronous filesystem work blocks the Node.js event loop while I/O completes.",
  suggestion: "Use the corresponding asynchronous API where blocking affects concurrency; measure startup and shutdown paths separately.",
  analyze(context) {
    const issues = [];
    walk(context.ast.program, { enter(node, ancestors) {
      const operation = moduleCall(context, node, fsModules, blockingFsMethods);
      if (operation) issues.push(finding(node, ancestors, { operation, message: `${operation} blocks the Node.js event loop.`, suggestion: blockingFs.suggestion }));
    }});
    return issues;
  }
};

const syncProcessMethods = new Set(["execFileSync", "execSync", "spawnSync"]);
const blockingProcess = {
  id: "node/no-sync-process", title: "Synchronous child process", category: "node", defaultSeverity: "error",
  description: "Reports synchronous calls imported from node:child_process or child_process.",
  rationale: "Synchronous child processes block the event loop until the child exits.",
  suggestion: "Use spawn, execFile, or exec asynchronously when the call runs on a concurrent path.",
  analyze(context) {
    const issues = [];
    walk(context.ast.program, { enter(node, ancestors) {
      const operation = moduleCall(context, node, processModules, syncProcessMethods);
      if (operation) issues.push(finding(node, ancestors, { operation, message: `${operation} blocks the event loop until the process exits.`, suggestion: blockingProcess.suggestion }));
    }});
    return issues;
  }
};

const awaitInLoop = {
  id: "async/no-await-in-loop", title: "Potentially sequential asynchronous loop", category: "async", defaultSeverity: "warning",
  description: "Reports await expressions directly controlled by a loop.",
  rationale: "Await in a loop can serialize independent work, but may be required for ordering, rate limits, or bounded memory.",
  suggestion: "If iterations are independent, consider bounded concurrency. Preserve sequential execution for dependencies, rate limits, or memory constraints; do not apply Promise.all indiscriminately.",
  analyze(context) {
    const issues = [];
    walk(context.ast.program, { enter(node, ancestors) {
      if (node.type === "AwaitExpression" && inLoop(ancestors)) issues.push(finding(node, ancestors, { message: "Await inside this loop may serialize independent operations.", suggestion: awaitInLoop.suggestion }));
    }});
    return issues;
  }
};

const repeatedDomQuery = {
  id: "browser/no-dom-query-in-loop", title: "DOM query inside a loop", category: "browser", defaultSeverity: "warning",
  description: "Reports repeated document lookups inside loops.",
  rationale: "Repeated selector resolution can add avoidable work in hot browser loops.",
  suggestion: "If the DOM is stable during the loop, resolve the reference once before entering it.",
  analyze(context) {
    const issues = [];
    const methods = new Set(["querySelector", "querySelectorAll", "getElementById", "getElementsByClassName", "getElementsByTagName"]);
    walk(context.ast.program, { enter(node, ancestors) {
      if (node.type !== "CallExpression" || node.callee.type !== "MemberExpression" || node.callee.object.type !== "Identifier") return;
      if (node.callee.object.name !== "document" || context.bindings.resolve(node, "document") || !methods.has(propertyName(node.callee)) || !inLoop(ancestors)) return;
      issues.push(finding(node, ancestors, { operation: propertyName(node.callee), message: "A DOM lookup is repeated on every loop iteration.", suggestion: repeatedDomQuery.suggestion }));
    }});
    return issues;
  }
};

const arrayMethods = new Set(["filter", "map", "reduce", "flatMap"]);
function arrayChainLength(node) {
  let count = 0;
  let current = node;
  while (current?.type === "CallExpression" && current.callee?.type === "MemberExpression" && arrayMethods.has(propertyName(current.callee))) {
    count += 1;
    current = current.callee.object;
  }
  return count;
}

const repeatedArrayPasses = {
  id: "js/repeated-array-passes", title: "Multiple collection traversals", category: "javascript", defaultSeverity: "info",
  description: "Reports chains of at least three full collection traversal methods.",
  rationale: "Several full passes may matter for large collections on measured hot paths.",
  suggestion: "Benchmark this hot path before replacing readable collection methods with a fused loop or reduce.",
  analyze(context) {
    const issues = [];
    walk(context.ast.program, { enter(node, ancestors) {
      const passes = arrayChainLength(node);
      if (node.type !== "CallExpression" || passes < 3) return;
      const parent = ancestors.at(-1);
      if (parent?.type === "MemberExpression" && parent.object === node && arrayMethods.has(propertyName(parent))) return;
      issues.push(finding(node, ancestors, { operation: `chain-${passes}`, message: `This chain traverses the collection ${passes} times.`, suggestion: repeatedArrayPasses.suggestion }));
    }});
    return issues;
  }
};

const intervalCleanup = {
  id: "runtime/track-interval", title: "Untracked interval", category: "runtime", defaultSeverity: "warning",
  description: "Reports global setInterval calls whose handle is discarded.",
  rationale: "A discarded interval handle cannot be passed to clearInterval during teardown.",
  suggestion: "Store or return the interval handle and call clearInterval during teardown.",
  analyze(context) {
    const issues = [];
    walk(context.ast.program, { enter(node, ancestors) {
      if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || node.callee.name !== "setInterval" || context.bindings.resolve(node, "setInterval")) return;
      const parent = ancestors.at(-1);
      const tracked = (parent?.type === "VariableDeclarator" && parent.init === node) || (parent?.type === "AssignmentExpression" && parent.right === node) || (parent?.type === "ReturnStatement" && parent.argument === node) || (parent?.type === "CallExpression" && parent.arguments.includes(node));
      if (!tracked) issues.push(finding(node, ancestors, { operation: "setInterval", message: "This interval handle is discarded and cannot be cleaned up directly.", suggestion: intervalCleanup.suggestion }));
    }});
    return issues;
  }
};

export const largeSourceFile = {
  id: "project/large-source-file", title: "Large source file", category: "project", defaultSeverity: "warning",
  description: "Reports source files larger than maxFileSizeKb.",
  rationale: "Very large source modules can increase parse, transform, and maintenance costs; generated files should normally be ignored.",
  suggestion: "Split responsibilities or exclude known generated data with a documented ignore pattern."
};

export const suppressionRules = [
  { id: "velocity/invalid-suppression", title: "Invalid suppression", description: "Reports malformed or unjustified suppression directives.", defaultSeverity: "warning", category: "governance", rationale: "Silent invalid directives create false confidence.", suggestion: "Use velocity-ignore-next-line <rule-id> -- <non-empty justification>." },
  { id: "velocity/unused-suppression", title: "Unused suppression", description: "Reports valid directives that suppress no finding.", defaultSeverity: "info", category: "governance", rationale: "Stale suppressions hide intent and can mask later findings.", suggestion: "Remove the directive or place it immediately above the intended finding." }
];

export const coreRules = [blockingFs, blockingProcess, awaitInLoop, repeatedDomQuery, repeatedArrayPasses, intervalCleanup];
export const allRules = [...coreRules, largeSourceFile, ...suppressionRules];
export const ruleById = new Map(allRules.map((rule) => [rule.id, rule]));
