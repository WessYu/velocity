import { ruleById } from "./rules/core.js";
import { packageVersion } from "./package-meta.js";

const levels = { error: "error", warning: "warning", info: "note" };
function artifactUri(file) { return file.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/"); }

export function toSarif(report) {
  const usedRules = [...new Set(report.issues.map((issue) => issue.rule))].sort();
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [{
      tool: { driver: {
        name: "Velocity",
        informationUri: "https://github.com/WessYu/velocity",
        semanticVersion: packageVersion,
        rules: usedRules.map((id) => {
          const rule = ruleById.get(id);
          return { id, name: rule?.title ?? id, shortDescription: { text: rule?.description ?? id }, fullDescription: { text: rule?.rationale ?? rule?.description ?? id }, help: { text: rule?.suggestion ?? "Review the finding." }, helpUri: `https://github.com/WessYu/velocity/blob/main/docs/rules/${id.replace("/", "-")}.md`, defaultConfiguration: { level: levels[rule?.defaultSeverity] ?? "warning" } };
        })
      } },
      results: report.issues.map((issue) => ({
        ruleId: issue.rule,
        level: levels[issue.severity],
        message: { text: `${issue.message} ${issue.suggestion}` },
        partialFingerprints: { velocityFingerprint: issue.fingerprint },
        locations: [{ physicalLocation: { artifactLocation: { uri: artifactUri(issue.file), uriBaseId: "%SRCROOT%" }, region: { startLine: issue.line, startColumn: issue.column ?? 1, endLine: issue.endLine ?? issue.line, endColumn: issue.endLine === issue.line ? Math.max(issue.endColumn ?? 0, (issue.column ?? 1) + 1) : issue.endColumn ?? 1 } } }]
      }))
    }]
  };
}
