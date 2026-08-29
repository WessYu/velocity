# Contributing

Velocity accepts focused changes backed by fixtures that demonstrate both the intended finding and likely false positives.

1. Use Node.js 20, 22, or 24.
2. Run `npm ci`.
3. Add positive and negative tests for rule changes.
4. Run `npm run check` and `npm pack --dry-run`.
5. Update rule docs and schemas when behavior or public shapes change.

Rules must depend only on analysis context, never on the CLI or reporters. New public exports and schema changes require an explicit compatibility review. Performance claims require benchmark evidence; readable code should not be replaced solely on intuition.
