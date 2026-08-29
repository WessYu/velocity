export const SCORE_VERSION = 1;
export const SCORE_WEIGHTS = Object.freeze({ error: 12, warning: 5, info: 1 });
export function calculateHealthScore(issues) {
  return Math.max(0, 100 - issues.reduce((total, issue) => total + SCORE_WEIGHTS[issue.severity], 0));
}
