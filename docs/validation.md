# Validation Notes

These notes track early alpha validation. Do not vendor external repositories into this repo; clone them separately and record the command, top findings, false positives, and any tuning changes.

## Local Fixtures

### React messy dashboard

Command:

```bash
npm run dev -- scan --path examples/react-messy-dashboard --no-ai --limit 5 --min-priority low
```

Expected useful findings:

- API/data loading inside `Dashboard.tsx`.
- Hook/state extraction opportunity.
- Branch-heavy `classifyItem` function.

Known rough edge:

- This fixture is intentionally tiny, so scores are more sensitive to threshold changes than a real app.

### Python service

Command:

```bash
npm run dev -- scan --path examples/python-service --no-ai --limit 5 --min-priority low
```

Expected useful findings:

- Branch-heavy `calculate_invoice_total`.
- Data-fetching and validation responsibility tags.

Known rough edge:

- Python analysis is heuristic and does not understand decorators, imports, or type flow semantically.

### Java service

Command:

```bash
npm run dev -- scan --path examples/java-service --no-ai --limit 5 --min-priority low
```

Expected useful findings:

- Branch-heavy `scoreUser`.
- Data-fetching signal from `RestTemplate`.

Known rough edge:

- Java support is regex-based and does not parse constructors, overloads, annotations, or package structure deeply.

## Public Repo Smoke Tests

Validated with the built local CLI on 2026-05-02. External repositories were cloned under `/tmp/refactor-coach-validation` and were not vendored.

### TodoMVC React example

Command:

```bash
node dist/cli/index.js scan --path examples/react --no-ai --limit 5 --min-priority medium
```

Result:

- Files scanned: 12
- Opportunities: 15
- Top findings: `Add Tests Before Refactoring Input`, `Clarify Responsibilities In Footer`, `Clarify Responsibilities In Main`
- Tuning: full-repo scan exposed old vendored `bower_components`, so `bower_components` was added to default excludes.

### Vercel Next Learn

Command:

```bash
node dist/cli/index.js scan --no-ai --limit 5 --min-priority medium
```

Result:

- Files scanned: 128
- Opportunities: 79
- Top findings: `Deduplicate Layout Logic`, `Deduplicate getSortedPostsData Logic`, `Deduplicate getAllPostIds Logic`
- Tuning: suppressed generic duplicate opportunities named only as `anonymous_line_*` unless a known duplicate pattern is detected.

### FastAPI full-stack template

Command:

```bash
node dist/cli/index.js scan --no-ai --limit 5 --min-priority medium
```

Result:

- Files scanned: 140
- Opportunities: 126
- Top findings: `Add Tests Before Refactoring catchErrorCodes`, `Add Tests Before Refactoring SidebarProvider`, `Extract Hook From SidebarProvider`
- Note: this repo includes a TypeScript frontend and Python backend. Current ranking strongly favors the frontend because JS/TS analysis is more precise.

### Spring PetClinic

Command:

```bash
node dist/cli/index.js scan --no-ai --limit 5 --min-priority medium
```

Result:

- Files scanned: 47
- Opportunities: 10
- Top findings: `Add Tests Before Refactoring parse`, `Add Tests Before Refactoring getPet`, `Add Tests Before Refactoring processCreationForm`
- Note: Java findings were all Low priority with default thresholds, so `--min-priority medium` generated no prompt files. This is acceptable for alpha but should be watched as Java heuristics improve.

## 2026-05-02 Friends App Smoke Test

Command:

```bash
node dist/cli/index.js scan --no-ai --limit 20 --min-priority medium
```

Result:

- Working directory: `/Users/feez/Desktop/Friends App`
- Framework: Expo
- Files scanned: 58
- Opportunities: 92
- Generated prompts: 20
- Top findings: `Add Tests Before Refactoring FriendDetailScreen`, `Clarify Responsibilities In FriendDetailScreen`, `Add Tests Before Refactoring VoiceFillSheet`, `Clarify Responsibilities In VoiceFillSheet`, `Extract Hook From FriendDetailScreen`
- Outcome: large untested screens/components rank above tiny helper deduplications, and Expo detection is working.
