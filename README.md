# Refactor Coach

[![CI](https://github.com/FeezRM/refactor-coach/actions/workflows/ci.yml/badge.svg)](https://github.com/FeezRM/refactor-coach/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Refactor Coach is a local-first CLI that scans a codebase, finds risky refactor candidates, and turns them into small, reviewable tasks for coding agents.

It does not edit your source code. It produces reports, JSON scan data, task lists, and bounded prompts that you can hand to Claude Code, Codex, Cursor, Cline, Aider, or another agent while you stay in control of the diff.

> Alpha software: findings are heuristic, false positives are expected, and every generated task should be reviewed by an engineer before implementation.

## Why Use It

Large refactors usually fail because the first step is too broad. Refactor Coach keeps the first step small:

- Finds high-risk files, complex functions, mixed responsibilities, duplicated logic, missing tests, TODOs, and data-call smells.
- Ranks opportunities by impact, risk, confidence, and priority.
- Generates prompts that name the target files, likely tests, constraints, and acceptance criteria.
- Tracks agent-led refactor runs with a baseline, file hashes, check output, and completion notes.
- Works offline by default; AI summaries are optional.

## Language Support

| Language or stack | Analysis level | What is detected |
| --- | --- | --- |
| TypeScript, JavaScript | Strongest | Imports, exports, functions, React components, hooks, UI data calls, duplication, complexity, nearby tests |
| React, Next.js, Expo, React Native | Strongest | Large components, hook-heavy components, UI/service boundary issues, workspace context |
| Python | Alpha heuristic | Async and typed functions, FastAPI/Flask/Django routing, Pydantic/Marshmallow validation, SQLAlchemy/Django DB usage, HTTP clients, complex functions |
| Java | Alpha heuristic | Methods and constructors, Spring routing annotations, validation annotations, JDBC/JPA usage, HTTP clients, complex methods |

Python and Java support is intentionally conservative. It is designed to produce useful refactor hints, not compiler-grade semantic analysis.

## Installation

Refactor Coach requires Node.js 18 or newer.

From npm, once the package is published:

```bash
npm install -g refactor-coach
refactor-coach scan --no-ai
```

Run without a global install:

```bash
npx refactor-coach scan --no-ai
```

Use this repository directly:

```bash
git clone https://github.com/FeezRM/refactor-coach.git
cd refactor-coach
npm install
npm run build
npm link
refactor-coach scan --no-ai
```

For local development, you can run the CLI without linking:

```bash
npm run dev -- scan --no-ai
```

## Quick Start

Run a focused scan from the root of another project:

```bash
cd your-project
refactor-coach scan --no-ai --limit 10 --min-priority medium
```

Example output:

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

The generated `.refactor-coach/` directory contains:

```text
.refactor-coach/
  report.md
  refactor_tasks.md
  prompts/
    01_split_large_dashboard_component.md
  data/
    scan.json
    output-settings.json
```

See [`examples/demo-output`](examples/demo-output) for a trimmed report and generated prompt.

## Agent Workflow

Use Refactor Coach as the planning and verification layer around an agent-led edit:

```bash
refactor-coach scan --no-ai --limit 10
refactor-coach next --format json
refactor-coach begin 1
# Give .refactor-coach/runs/<runId>/task.md to your coding agent.
refactor-coach check --run latest
refactor-coach complete --run latest
```

`begin` creates a tracked run without editing source files. It records the selected task, current git status, target file hashes, and baseline copies of the files involved.

```text
.refactor-coach/runs/<runId>/
  task.md
  baseline.json
  baseline-files/
  check.json
  check.md
  result.md
```

`check` compares the current working tree with the baseline and can run detected or configured verification commands. Dirty repositories are allowed by default, but unrelated changes are called out.

## Command Reference

```bash
refactor-coach scan
refactor-coach scan --path ./src
refactor-coach scan --format markdown
refactor-coach scan --format json
refactor-coach scan --no-ai
refactor-coach scan --provider openai --model gpt-4.1-mini
refactor-coach scan --limit 10 --min-priority high

refactor-coach next --format markdown
refactor-coach next --format json

refactor-coach begin 1
refactor-coach begin 1 --max-files 4
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

Create `.refactorcoachrc.json` in the repository root:

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

When `checks.autoDetect` is enabled, Refactor Coach uses package scripts in this order when present: `typecheck`, `test`, `lint`, `build`.

## Optional AI Summaries

AI is disabled by default. Enable it through config or by passing a provider/model on the scan command.

Supported providers:

- OpenAI with `OPENAI_API_KEY`
- Anthropic with `ANTHROPIC_API_KEY`
- Ollama with `OLLAMA_HOST`, defaulting to `http://localhost:11434`

Example:

```bash
refactor-coach scan --provider openai --model gpt-4.1-mini --limit 10
```

Optional AI summaries are used to enrich opportunity explanations. The scanner, reports, JSON output, and prompts work without an AI provider.

## Safe Usage

- Run from a git repository so every agent edit is easy to inspect.
- Start with `scan --no-ai --limit 10`.
- Read `.refactor-coach/report.md` before handing prompts to an agent.
- Add characterization tests before changing risky logic.
- Use `begin`, `check`, and `complete` for larger changes.
- Treat Python and Java findings as alpha hints until the heuristics mature.

## Known Limitations

- Findings are heuristic and ranking can still be noisy.
- Python and Java analysis does not perform type resolution, control-flow analysis, or framework-specific semantic parsing.
- Refactor Coach does not apply patches or perform automatic refactors.
- Dynamic imports, metaprogramming, generated code, and semantic duplication can be missed.
- Generated prompts are bounded, but they still require engineer review.
- `.refactor-coach/` can contain many files unless `--limit` and `--min-priority` are tuned.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Run the demo scan locally:

```bash
npm run dev -- scan --path examples/react-messy-dashboard --no-ai --limit 5
npm run dev -- scan --path examples/python-service --no-ai --limit 5 --min-priority low
npm run dev -- scan --path examples/java-service --no-ai --limit 5 --min-priority low
```

Contributions are welcome. Small fixtures, false-positive reports, and focused heuristic improvements with tests are the most useful alpha-stage contributions. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
