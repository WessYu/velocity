import { location } from "./ast.js";
import { ruleById } from "./rules/core.js";

const marker = /velocity-ignore(?:-next-line|-line)?/;
const directive = /^\s*velocity-ignore-(next-line|line)\s+(\S+)\s+--\s+(.+?)\s*$/;

export function applySuppressions(ast, findings, file) {
  const suppressions = [];
  const diagnostics = [];
  for (const comment of ast.comments ?? []) {
    if (!marker.test(comment.value)) continue;
    const match = comment.value.match(directive);
    if (!match) {
      diagnostics.push({ rule: "velocity/invalid-suppression", title: "Invalid suppression", severity: "warning", file, ...location(comment), message: "Malformed suppression directive or missing justification.", suggestion: "Use velocity-ignore-next-line <rule-id> -- <non-empty justification>.", symbol: "suppression" });
      continue;
    }
    const [, mode, rule, reason] = match;
    if (!ruleById.has(rule) || rule.startsWith("velocity/")) {
      diagnostics.push({ rule: "velocity/invalid-suppression", title: "Invalid suppression", severity: "warning", file, ...location(comment), message: `Unknown or unsupported suppression rule ID: ${rule}.`, suggestion: "Use a rule ID printed by velocity rules.", symbol: "suppression" });
      continue;
    }
    suppressions.push({ rule, reason: reason.trim(), line: comment.loc.start.line, targetLine: mode === "next-line" ? comment.loc.end.line + 1 : comment.loc.start.line, used: false });
  }

  const remaining = findings.filter((finding) => {
    const match = suppressions.find((item) => item.rule === finding.rule && item.targetLine === finding.line);
    if (!match) return true;
    match.used = true;
    return false;
  });
  for (const item of suppressions.filter((entry) => !entry.used)) {
    diagnostics.push({ rule: "velocity/unused-suppression", title: "Unused suppression", severity: "info", file, line: item.line, column: 1, endLine: item.line, endColumn: 1, message: `Suppression for ${item.rule} did not match a finding.`, suggestion: "Remove the stale directive or move it immediately above the intended line.", symbol: "suppression" });
  }
  return { findings: remaining, diagnostics };
}
