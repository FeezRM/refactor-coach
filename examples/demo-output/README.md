# Demo Output

This folder contains trimmed example output from scanning the local fixtures. It is intentionally small so readers can see the report and prompt shape without committing a full `.refactor-coach/` directory.

Reproduce locally:

```bash
npm install
npm run build
node dist/cli/index.js scan --path examples/react-messy-dashboard --no-ai --limit 3 --min-priority low
```

The committed examples are illustrative. Real scores and ordering can change as the heuristics improve.
