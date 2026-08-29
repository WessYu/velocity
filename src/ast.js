const ignoredKeys = new Set(["loc", "start", "end", "range", "extra", "leadingComments", "trailingComments", "innerComments"]);

export function childNodes(node) {
  const children = [];
  for (const [key, value] of Object.entries(node ?? {})) {
    if (ignoredKeys.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === "string") children.push(item);
    } else if (value && typeof value.type === "string") children.push(value);
  }
  return children;
}

export function walk(node, visitor, ancestors = []) {
  if (!node || typeof node.type !== "string") return;
  visitor.enter?.(node, ancestors);
  const nextAncestors = [...ancestors, node];
  for (const child of childNodes(node)) walk(child, visitor, nextAncestors);
  visitor.leave?.(node, ancestors);
}

export function location(node) {
  return { line: node.loc?.start.line ?? 1, column: (node.loc?.start.column ?? 0) + 1, endLine: node.loc?.end.line ?? node.loc?.start.line ?? 1, endColumn: (node.loc?.end.column ?? node.loc?.start.column ?? 0) + 1 };
}

export function propertyName(node) {
  if (!node) return null;
  if (!node.computed && node.property?.type === "Identifier") return node.property.name;
  if (node.computed && ["StringLiteral", "Literal"].includes(node.property?.type)) return node.property.value;
  return null;
}

export function identifierNames(pattern) {
  if (!pattern) return [];
  if (pattern.type === "Identifier") return [pattern.name];
  if (pattern.type === "RestElement") return identifierNames(pattern.argument);
  if (pattern.type === "AssignmentPattern") return identifierNames(pattern.left);
  if (pattern.type === "ObjectPattern") return pattern.properties.flatMap((property) => identifierNames(property.value ?? property.argument));
  if (pattern.type === "ArrayPattern") return pattern.elements.flatMap(identifierNames);
  return [];
}

export function isFunction(node) {
  return ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"].includes(node?.type);
}

export function nearestFunctionName(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (!isFunction(node)) continue;
    if (node.id?.name) return node.id.name;
    const parent = ancestors[index - 1];
    if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name;
    if (["ObjectProperty", "ObjectMethod", "ClassMethod"].includes(parent?.type)) return propertyName(parent) ?? "anonymous";
    return "anonymous";
  }
  return "module";
}

function isRequireCall(node) {
  return node?.type === "CallExpression" && node.callee?.type === "Identifier" && node.callee.name === "require" && node.arguments?.[0]?.type === "StringLiteral";
}

class Scope {
  constructor(parent, kind) { this.parent = parent; this.kind = kind; this.bindings = new Map(); }
  resolve(name) { return this.bindings.get(name) ?? this.parent?.resolve(name) ?? null; }
}

function createsScope(node) {
  return node.type === "Program" || isFunction(node) || node.type === "BlockStatement" || node.type === "CatchClause";
}

function declarationScope(scope, kind) {
  if (kind !== "var") return scope;
  let target = scope;
  while (target.parent && !["program", "function"].includes(target.kind)) target = target.parent;
  return target;
}

function addPattern(scope, pattern, binding = { kind: "local" }) {
  for (const name of identifierNames(pattern)) scope.bindings.set(name, binding);
}

/** A small lexical binding model used by identity-sensitive rules. */
export function buildBindings(ast) {
  const scopeByNode = new WeakMap();
  let current = null;
  walk(ast.program ?? ast, {
    enter(node, ancestors) {
      if (createsScope(node)) current = new Scope(current, node.type === "Program" ? "program" : isFunction(node) ? "function" : "block");
      scopeByNode.set(node, current);
      if (isFunction(node)) {
        if (node.type === "FunctionDeclaration" && node.id && current.parent) current.parent.bindings.set(node.id.name, { kind: "local" });
        if (node.id && node.type !== "FunctionDeclaration") current.bindings.set(node.id.name, { kind: "local" });
        for (const parameter of node.params ?? []) addPattern(current, parameter);
      }
      if (node.type === "CatchClause") addPattern(current, node.param);
      if (node.type === "ClassDeclaration" && node.id) current.bindings.set(node.id.name, { kind: "local" });
      if (node.type === "ImportDeclaration") {
        for (const specifier of node.specifiers) {
          const imported = ["ImportDefaultSpecifier", "ImportNamespaceSpecifier"].includes(specifier.type) ? "*" : specifier.imported.name ?? specifier.imported.value;
          current.bindings.set(specifier.local.name, { kind: "module", module: node.source.value, imported });
        }
      }
      if (node.type === "VariableDeclarator") {
        addPattern(declarationScope(current, ancestors.at(-1)?.kind), node.id);
      }
    },
    leave(node) { if (createsScope(node)) current = current.parent; }
  });
  walk(ast.program ?? ast, { enter(node, ancestors) {
    if (node.type !== "VariableDeclarator" || !isRequireCall(node.init)) return;
    const scope = declarationScope(scopeByNode.get(node), ancestors.at(-1)?.kind);
    if (scope.resolve("require")) return;
    const module = node.init.arguments[0].value;
    if (node.id.type === "Identifier") scope.bindings.set(node.id.name, { kind: "module", module, imported: "*" });
    if (node.id.type === "ObjectPattern") {
      for (const property of node.id.properties) {
        if (property.type !== "ObjectProperty") continue;
        const imported = property.key.name ?? property.key.value;
        for (const local of identifierNames(property.value)) scope.bindings.set(local, { kind: "module", module, imported });
      }
    }
  }});
  return { resolve(node, name) { return scopeByNode.get(node)?.resolve(name) ?? null; } };
}
