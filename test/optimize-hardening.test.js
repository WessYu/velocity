import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyOptimizations, createOptimizationPlan } from "../src/optimize.js";
import { temporaryFixture } from "./helpers.js";

test("resolves Vite image imports, public assets, new URL and WebP VP8X for review", async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const sourceFile = path.join(fixture.directory, "src", "App.jsx");
    await writeFile(path.join(fixture.directory, "src", "imported.svg"), '<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg"></svg>');
    await writeFile(path.join(fixture.directory, "src", "via-url.svg"), '<svg width="320" height="180" xmlns="http://www.w3.org/2000/svg"></svg>');
    await writeFile(path.join(fixture.directory, "public", "public-image.svg"), '<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"></svg>');
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii"); webp.writeUInt32LE(22, 4); webp.write("WEBP", 8, "ascii"); webp.write("VP8X", 12, "ascii"); webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(1199, 24, 3); webp.writeUIntLE(799, 27, 3);
    await writeFile(path.join(fixture.directory, "src", "hero.webp"), webp);
    await writeFile(sourceFile, `import imported from "./imported.svg";\nimport hero from "./hero.webp";\nexport default function App(){return <><img src={imported}/><img src={new URL("./via-url.svg", import.meta.url).href}/><img src="/public-image.svg"/><img src={hero}/></>}\n`);
    const plan = await createOptimizationPlan(fixture.directory);
    const sizes = plan.optimizations.filter((item) => item.id.startsWith("size-image-"));
    assert.equal(sizes.length, 4);
    assert.ok(sizes.every((item) => item.classification === "review-required"));
    for (const dimensions of ["640×360", "320×180", "800×600", "1200×800"]) assert.ok(sizes.some((item) => item.evidence.includes(dimensions)));
    assert.ok(sizes.some((item) => item.evidence.includes("WebP VP8X")));
    assert.equal(plan.findings.filter((item) => item.id === "image/review-loading-policy").length, 4);
  } finally { await fixture.cleanup(); }
});

test("rollback preserves an edit made after Velocity applied its patch and creates recovery output", { timeout: 60_000 }, async () => {
  const fixture = await temporaryFixture("vite-app");
  try {
    const sourceFile = path.join(fixture.directory, "src", "App.jsx");
    await writeFile(path.join(fixture.directory, "vite.config.js"), "import{readFileSync,writeFileSync}from'node:fs';const file='src/App.jsx';const source=readFileSync(file,'utf8');if(source.includes('width={1200}')){writeFileSync(file,source+'\\n// external edit\\n');throw new Error('validation failure')}export default{build:{manifest:true}};\n");
    const plan = await createOptimizationPlan(fixture.directory);
    const fix = plan.optimizations.find((item) => item.id.startsWith("size-image-"));
    const run = await applyOptimizations(fixture.directory, { fixes: [fix.id] });
    assert.equal(run.verification.classification, "failed");
    assert.equal(run.rolledBack.length, 0);
    assert.equal(run.rollbackConflicts.length, 1);
    assert.equal(run.recoveryArtifacts.length, 1);
    assert.match(await readFile(sourceFile, "utf8"), /external edit/);
    const recovery = await readFile(path.join(fixture.directory, run.recoveryArtifacts[0]), "utf8");
    assert.doesNotMatch(recovery, /width=\{1200\}/);
  } finally { await fixture.cleanup(); }
});
