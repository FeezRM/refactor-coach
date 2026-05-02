# AI Refactor Coach Report

## Summary

- Files scanned: 1
- High-priority opportunities: 0
- Medium-priority opportunities: 6
- Low-priority opportunities: 0
- Highest-risk area: `examples/react-messy-dashboard/src/Dashboard.tsx`
- Best first refactor: `examples/react-messy-dashboard/src/Dashboard.tsx`
- Opportunities shown in this report: 3

## Top Refactor Opportunities

### 1. Add Tests Before Refactoring Dashboard

**File:** `examples/react-messy-dashboard/src/Dashboard.tsx`  
**Type:** Add Tests Before Refactor  
**Priority:** Medium (66)  
**Impact:** 7/10  
**Risk:** 4/10  
**Confidence:** 10/10

#### Why this matters

This area has enough complexity or sensitivity that changing structure without tests would be risky. Characterization tests should lock down current behavior before any extraction work starts.

#### Recommended refactor

- Add focused tests around `Dashboard` and the most important user-visible or data behavior.
- Cover success, failure, and edge-case branches that are easy to break during extraction.
- Run the test suite before starting any structural refactor.

#### AI Agent Prompt

See: `prompts/01_add_tests_before_refactoring_dashboard.md`

### 2. Clarify Responsibilities In Dashboard

**File:** `examples/react-messy-dashboard/src/Dashboard.tsx`  
**Type:** Improve Module Boundaries  
**Priority:** Medium (63)

#### Why this matters

This file appears to combine several responsibilities. Clearer module boundaries reduce the chance that a UI, data, validation, or state change accidentally affects unrelated behavior.

### 3. Extract Hook From Dashboard

**File:** `examples/react-messy-dashboard/src/Dashboard.tsx`  
**Type:** Extract Custom Hook  
**Priority:** Medium (58)

#### Why this matters

This component uses enough hooks that state transitions, effects, and rendering are probably tightly coupled. Extracting a focused hook can isolate behavior while keeping the UI component easier to scan.
