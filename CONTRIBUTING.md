# Contributing

Refactor Coach is alpha software. The highest-value contributions are small fixtures, false-positive reports, and focused heuristic improvements with tests.

## Local Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Run the CLI locally:

```bash
npm run dev -- scan --no-ai --limit 10
```

## Reporting False Positives

Please include:

- Language and framework.
- The command you ran.
- The relevant `.refactor-coach/data/scan.json` opportunity or report section.
- Why the finding was noisy or incorrectly ranked.
- A small fixture or reduced code sample when possible.

Avoid sharing private source code unless it is safe to publish.

## Adding Tests

Use `tests/scanner.test.ts` for scanner, scoring, output, and run workflow regressions. Prefer small in-test fixtures over large committed projects unless the fixture is meant to be a public example.

Before opening a PR, run:

```bash
npm run typecheck
npm test
npm run build
npm pack --dry-run
```
