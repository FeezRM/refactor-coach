---
name: refactor-coach
description: 'Use when: scanning for refactor opportunities, starting/checking/completing a refactor run, or printing prompts with refactor-coach.'
user-invocable: true
---

# Refactor Coach Skill

Use this skill to run the **refactor-coach** CLI against a codebase and act on its output. The CLI scans for risky refactor candidates, ranks them, generates bounded prompts, and tracks agent-led runs — without modifying source files itself.

---

## When to use this skill

Invoke this skill when the user asks to:

- Scan a project for refactor opportunities
- Pick the next refactor task
- Begin, check, or complete a tracked refactor run
- Apply a generated prompt to a specific opportunity
- Explain a file or list current tasks

---

## CLI reference

The binary is `refactor-coach` (globally installed via `npm link` or `npm install -g refactor-coach`). For local development use `npm run dev --` instead.

### Core workflow

```bash
# 1. Scan — always start here
refactor-coach scan --no-ai --limit 10 --min-priority medium

# 2. Review the top candidate
refactor-coach next --format markdown

# 3. Begin a tracked run for opportunity #1
refactor-coach begin 1

# 4. Hand .refactor-coach/runs/<runId>/task.md to the coding agent and apply the changes

# 5. Verify the run
refactor-coach check --run latest

# 6. Mark complete
refactor-coach complete --run latest
```

### All commands

| Command                 | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `scan`                  | Scan the codebase and write report + prompts       |
| `next`                  | Show the highest-priority unbegun opportunity      |
| `begin <n>`             | Start a tracked run for opportunity #n             |
| `apply <n>`             | Alias for begin — starts a run and prints the task |
| `check --run latest`    | Diff current tree against baseline, run checks     |
| `complete --run latest` | Mark the run done and record notes                 |
| `explain <file>`        | Explain refactor risk for a specific file          |
| `prompt <n>`            | Print the generated prompt for opportunity #n      |
| `tasks`                 | List all opportunities from the last scan          |

### Key flags

| Flag                | Default  | Notes                                           |
| ------------------- | -------- | ----------------------------------------------- |
| `--no-ai`           | —        | Skip AI summaries (recommended for offline use) |
| `--limit <n>`       | 20       | Cap opportunities shown                         |
| `--min-priority`    | medium   | `low`, `medium`, `high`, `critical`             |
| `--path <dir>`      | `.`      | Directory to scan                               |
| `--format`          | markdown | `markdown` or `json`                            |
| `--provider`        | —        | `openai`, `anthropic`, `ollama`                 |
| `--model`           | —        | Model name for the chosen provider              |
| `--max-files <n>`   | 8        | Max files included in a single run              |
| `--no-run-commands` | —        | Skip check commands during `check`              |
| `--command <cmd>`   | —        | Override check command                          |

---

## Output layout

After `scan`, the `.refactor-coach/` directory contains:

```
.refactor-coach/
  report.md               ← human-readable summary
  refactor_tasks.md       ← ranked task list
  prompts/
    01_<slug>.md          ← bounded agent prompt per opportunity
  data/
    scan.json             ← full machine-readable findings
    output-settings.json
  runs/<runId>/
    task.md               ← prompt handed to the agent
    baseline.json         ← git status + file hashes at begin time
    baseline-files/       ← copies of target files
    check.json
    check.md
    result.md
```

---

## How to use this skill

1. **Scan first.** Always run `scan --no-ai` before any other command. Read `.refactor-coach/report.md` before proceeding.
2. **Pick a task.** Use `next` or `tasks` to choose an opportunity. Prefer high-confidence, lower-risk items first.
3. **Read the prompt.** Open `.refactor-coach/prompts/<slug>.md` and review the named files, constraints, and acceptance criteria before editing anything.
4. **Begin a run.** Call `begin <n>` to snapshot the baseline. This does not touch source files.
5. **Apply changes.** Work through the task described in `.refactor-coach/runs/<runId>/task.md`. Stay within the listed files unless you have a strong reason to expand scope.
6. **Check.** Run `check --run latest` to compare the diff against the baseline and execute auto-detected verify commands (`typecheck`, `test`, `lint`, or `build`).
7. **Complete.** Run `complete --run latest` when checks pass. Add brief notes describing what changed.

---

## Configuration

If `.refactorcoachrc.json` does not exist, the CLI uses safe defaults. Create it to tune thresholds:

```json
{
  "include": ["**/*.{ts,tsx,js,jsx,py,java}"],
  "exclude": ["node_modules", "dist", ".next", "coverage"],
  "thresholds": {
    "largeFileLines": 300,
    "largeComponentLines": 250,
    "complexFunctionLines": 60,
    "maxFunctionParams": 5,
    "maxHooksInComponent": 8,
    "complexFunctionComplexity": 12,
    "maxResponsibilities": 4
  },
  "ai": { "enabled": false },
  "output": {
    "directory": ".refactor-coach",
    "limit": 20,
    "minPriority": "medium"
  },
  "agent": { "allowDirty": true, "maxFilesPerTask": 8 },
  "checks": { "commands": [], "autoDetect": true }
}
```

---

## Safety rules

- **Never skip the baseline.** Always `begin` before editing; this is what `check` diffs against.
- **Stay in scope.** Only edit files named in the task prompt unless expansion is clearly necessary.
- **Run from a git repo.** Every agent edit should be inspectable via `git diff`.
- **Start with `--no-ai`.** AI summaries are optional enrichment, not required for useful output.
- **Treat Python and Java findings as alpha hints.** They use heuristic analysis without type resolution.
- **Review before applying.** Findings can include false positives. Engineer judgement is required before acting on any prompt.
