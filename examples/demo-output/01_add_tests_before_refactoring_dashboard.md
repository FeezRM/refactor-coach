# Refactor Task: Add Tests Before Refactoring Dashboard

## Goal

Refactor `examples/react-messy-dashboard/src/Dashboard.tsx` to improve maintainability without changing behavior.

## Current Problem

This area has enough complexity or sensitivity that changing structure without tests would be risky. Characterization tests should lock down current behavior before any extraction work starts.

Evidence from the scan:

- File appears to combine auth, business-logic, data-fetching, state, ui responsibilities.
- `Dashboard` is complex.
- `classifyItem` is branch-heavy.

## Codebase Context

- `examples/react-messy-dashboard/src/Dashboard.tsx`: typescript, workspace/framework: unknown

## Required Changes

- Add focused tests around `Dashboard` and the most important user-visible or data behavior.
- Cover success, failure, and edge-case branches that are easy to break during extraction.
- Run the test suite before starting any structural refactor.

## Constraints

- Do not change user-facing behavior.
- Do not change public API names unless absolutely necessary.
- Keep existing tests passing.
- Add tests before refactoring if behavior is not currently covered.
- Prefer small, reviewable changes.
- Do not make unrelated formatting-only rewrites.

## Why This Task Is Bounded

Only work on the target component and the smallest test file needed for this opportunity. Do not combine this task with component splitting, hook extraction, or service extraction.

## Files Likely Involved

- `examples/react-messy-dashboard/src/Dashboard.tsx`
- `examples/react-messy-dashboard/src/Dashboard.test.tsx`

## Acceptance Criteria

- Tests describe current loading, success, error, and branch behavior.
- Existing behavior is unchanged.
- No unrelated files are modified.
