import test from "node:test";
import assert from "node:assert/strict";
import { getRuleCatalog } from "../src/index.js";
import { toSarif } from "../src/sarif.js";

test("SARIF maps known and unknown rules, severities, encoded paths and location fallbacks", () => {
  const known = getRuleCatalog()[0].id;
  const report = {
    issues: [
      { rule: known, severity: "error", message: "Known issue", suggestion: "Fix it", fingerprint: "a", file: "src\\space name.js", line: 2, column: null, endLine: 2, endColumn: null },
      { rule: "unknown/custom", severity: "warning", message: "Unknown issue", suggestion: "Review it", fingerprint: "b", file: "src/multi.js", line: 4, column: 3, endLine: 6, endColumn: null },
      { rule: "unknown/custom", severity: "info", message: "Info issue", suggestion: "Inspect it", fingerprint: "c", file: "src/info.js", line: 1, column: 8, endLine: 1, endColumn: 12 }
    ]
  };
  const sarif = toSarif(report);
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].tool.driver.rules.length, 2);
  const unknown = sarif.runs[0].tool.driver.rules.find((rule) => rule.id === "unknown/custom");
  assert.equal(unknown.name, "unknown/custom");
  assert.equal(unknown.shortDescription.text, "unknown/custom");
  assert.equal(unknown.fullDescription.text, "unknown/custom");
  assert.equal(unknown.help.text, "Review the finding.");
  assert.equal(unknown.defaultConfiguration.level, "warning");
  assert.match(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, /space%20name\.js/);
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startColumn, 1);
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.endColumn, 2);
  assert.equal(sarif.runs[0].results[1].locations[0].physicalLocation.region.endColumn, 1);
  assert.equal(sarif.runs[0].results[2].level, "note");
  assert.equal(sarif.runs[0].results[2].locations[0].physicalLocation.region.endColumn, 12);
});

test("SARIF handles an empty report", () => {
  const sarif = toSarif({ issues: [] });
  assert.deepEqual(sarif.runs[0].tool.driver.rules, []);
  assert.deepEqual(sarif.runs[0].results, []);
});
