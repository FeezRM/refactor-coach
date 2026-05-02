# AI Refactor Coach

Experimental local-first CLI that finds messy areas in a codebase and turns them into safe, AI-ready refactor plans.

**Alpha status:** Refactor Coach is useful for quick audits, but the findings are heuristic and false positives are expected. It does not edit your code. Use it to guide Claude Code, Codex, Cursor, Cline, Aider, or another coding agent, then review every change.

## What It Does

- Scans JavaScript, TypeScript, React, Next.js, Expo, and React Native projects.
- Adds alpha heuristic support for Python and Java.
- Detects large files/components, complex functions/methods, mixed responsibilities, TODOs, duplicated function bodies, missing tests, and UI data-call smells.
- Writes markdown reports, JSON scan data, refactor task lists, and bounded agent prompts.
- Supports tracked agent-led runs with `begin`, `check`, and `complete`.

## Install

Global install after the package is published:

```bash
npm install -g refactor-coach
refactor-coach scan --no-ai
```

Run without installing globally:

```bash
npx refactor-coach scan --no-ai
```

Local development from this repo:

```bash
npm install
npm run build
npm link
refactor-coach scan --no-ai
```

Or run directly:

```bash
npm run dev -- scan --no-ai
```

## Quick Start

```bash
cd your-project
refactor-coach scan --no-ai --limit 10 --min-priority medium
```

Example terminal summary:

```text
AI Refactor Coach found 18 refactor opportunities.

Top recommendation:
1. Split Large Dashboard Component
   File: src/components/Dashboard.tsx
   Impact: 8/10  Risk: 4/10  Confidence: 8/10

Report written to .refactor-coach/report.md
Scan data written to .refactor-coach/data/scan.json
Generated prompts: 10 of 18 opportunities
AI prompts written to .refactor-coach/prompts
```

Example report excerpt:

```markdown
### 1. Move API Calls Out Of Dashboard

**File:** `src/components/Dashboard.tsx`
**Type:** Extract Service Layer
**Priority:** High
**Impact:** 8/10
**Risk:** 4/10
**Confidence:** 8/10

#### Suggested first step

Add a smoke test for loading, success, and error UI states before extracting requests.
```

See [`examples/demo-output`](examples/demo-output) for a trimmed report and generated prompt.

## Agent Workflow

Refactor Coach is meant to plan and verify. Your coding agent still performs the edit.

```bash
refactor-coach scan --no-ai --limit 10
refactor-coach next --format json
refactor-coach begin 1
# Give .refactor-coach/runs/<runId>/task.md to Claude Code, Codex, Cursor, Cline, or Aider.
refactor-coach check --run latest
refactor-coach complete --run latest
```

`begin` also has an `apply` alias:

```bash
refactor-coach apply 1 --format json
```

Tracked runs are written to:

```text
.refactor-coach/runs/<runId>/
  task.md
  baseline.json
  baseline-files/
  check.json
  check.md
  result.md
```

Dirty repos are allowed by default. `begin` records current git status and target file hashes. `check` warns when unrelated files changed.

## Output Volume

A scan creates a `.refactor-coach/` directory:

```text
.refactor-coach/
  report.md
  refactor_tasks.md
  prompts/
    01_split_large_dashboard_component.md
  data/
    scan.json
```

The JSON file keeps the complete scan. Human-facing report/task/prompt output is filtered by default to medium-or-higher priority and capped at 20 opportunities.

Use output controls when a repo produces too much:

```bash
refactor-coach scan --limit 5
refactor-coach scan --min-priority high
refactor-coach scan --limit 20 --min-priority medium
```

## Commands

```bash
refactor-coach scan
refactor-coach scan --path ./src
refactor-coach scan --format markdown
refactor-coach scan --format json
refactor-coach scan --no-ai
refactor-coach scan --limit 10 --min-priority high
refactor-coach next --format json
refactor-coach begin 1
refactor-coach apply 1
refactor-coach check --run latest
refactor-coach check --run latest --no-run-commands
refactor-coach check --run latest --command "npm test"
refactor-coach complete --run latest
refactor-coach explain src/components/Dashboard.tsx
refactor-coach prompt 1
refactor-coach tasks
```

## Configuration

Create `.refactorcoachrc.json` in the repo root:

```json
{
  "include": ["**/*.{ts,tsx,js,jsx,py,java}"],
  "exclude": ["node_modules", "bower_components", "dist", ".next", "coverage"],
  "thresholds": {
    "largeFileLines": 300,
    "largeComponentLines": 250,
    "complexFunctionLines": 60,
    "maxFunctionParams": 5,
    "maxHooksInComponent": 8,
    "complexFunctionComplexity": 12,
    "maxResponsibilities": 4
  },
  "ai": {
    "enabled": false,
    "provider": "openai",
    "model": "gpt-4.1-mini"
  },
  "output": {
    "directory": ".refactor-coach",
    "format": ["markdown", "json"],
    "limit": 20,
    "minPriority": "medium"
  },
  "agent": {
    "allowDirty": true,
    "maxFilesPerTask": 8
  },
  "checks": {
    "commands": [],
    "autoDetect": true
  }
}
```

When `checks.autoDetect` is enabled, package scripts are used in this order when present: `typecheck`, `test`, `lint`, `build`.

## Safe Usage

- Run on a git repo so you can inspect changes.
- Start with `scan --no-ai --limit 10`.
- Read the report before handing prompts to an agent.
- Use `begin` and `check` for larger agent-led refactors.
- Add characterization tests before changing risky logic.
- Treat Python and Java results as alpha hints, not authoritative analysis.

## Known Limitations

- Findings are heuristic and ranking can still be noisy.
- JS/TS/React analysis is strongest; Python and Java support is regex/heuristic alpha support.
- It does not perform automatic refactors or generate patches.
- It may miss semantic duplication, framework-specific conventions, and dynamic imports.
- Generated prompts are bounded, but still require engineer review.
- `.refactor-coach/` can contain many files unless `--limit` and `--min-priority` are used.
- Optional AI providers are not required and should not receive whole repositories.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

CI runs those checks on Node 20 and 22.

## License

MIT
