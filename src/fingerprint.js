import { createHash } from "node:crypto";

function normalizedMessage(message) { return message.replace(/\b\d+(?:\.\d+)?\b/g, "#").replace(/\s+/g, " ").trim(); }
export function addFingerprints(issues) {
  const occurrences = new Map();
  return issues.map((issue) => {
    const identity = [issue.rule, issue.file.replaceAll("\\", "/"), issue.symbol ?? "", normalizedMessage(issue.message)].join("\0");
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const fingerprint = createHash("sha256").update(`${identity}\0${occurrence}`).digest("hex").slice(0, 24);
    const { symbol: _symbol, ...publicIssue } = issue;
    return { ...publicIssue, fingerprint };
  });
}
