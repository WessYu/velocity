import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveRef(root, reference) {
  if (!reference.startsWith("#/")) throw new Error(`Only local schema refs are supported by the validator: ${reference}`);
  return reference.slice(2).split("/").reduce((value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], root);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validate(value, schema, root, location = "$") {
  if (!schema || typeof schema !== "object") throw new Error(`${location}: invalid schema node`);
  if (schema.$ref) return validate(value, resolveRef(root, schema.$ref), root, location);
  if ("const" in schema && value !== schema.const) throw new Error(`${location}: expected constant ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) throw new Error(`${location}: expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) throw new Error(`${location}: expected ${types.join(" or ")}`);
    if (value === null) return;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${location}: below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${location}: above maximum ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) throw new Error(`${location}: must be greater than ${schema.exclusiveMinimum}`);
  }
  if (typeof value === "string" && schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`${location}: shorter than ${schema.minLength}`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${location}: expected at least ${schema.minItems} items`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) throw new Error(`${location}: duplicate array items`);
    if (schema.items) value.forEach((item, index) => validate(item, schema.items, root, `${location}[${index}]`));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) if (!(required in value)) throw new Error(`${location}.${required}: required property is missing`);
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${location}.${key}: additional property is not allowed`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) if (key in value) validate(value[key], childSchema, root, `${location}.${key}`);
  }
}

async function readJson(file) { return JSON.parse(await readFile(file, "utf8")); }

async function validateSchemaDocuments() {
  const directory = path.join(rootDirectory, "schemas");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".schema.json")).sort();
  if (!files.length) throw new Error("No schema documents found");
  for (const file of files) {
    // velocity-ignore-next-line async/no-await-in-loop -- deterministic schema validation reports the exact failing document
    const schema = await readJson(path.join(directory, file));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error(`${file}: expected JSON Schema draft 2020-12`);
    if (typeof schema.$id !== "string" || !schema.$id.includes(`/schemas/${file}`)) throw new Error(`${file}: invalid or mismatched $id`);
    const refs = JSON.stringify(schema).match(/#\/[A-Za-z0-9_~/-]+/g) ?? [];
    for (const reference of refs) if (!resolveRef(schema, reference)) throw new Error(`${file}: unresolved local ref ${reference}`);
  }
  process.stdout.write(`Validated ${files.length} schema documents.\n`);
}

const [, , schemaArgument, dataArgument] = process.argv;
await validateSchemaDocuments();
if (schemaArgument || dataArgument) {
  if (!schemaArgument || !dataArgument) throw new Error("Usage: node scripts/validate-schemas.js <schema.json> <data.json>");
  const schema = await readJson(path.resolve(schemaArgument));
  const data = await readJson(path.resolve(dataArgument));
  validate(data, schema, schema);
  process.stdout.write(`Validated ${dataArgument} against ${schemaArgument}.\n`);
}
