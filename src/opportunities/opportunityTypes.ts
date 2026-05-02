import type { OpportunityType } from '../core/types.js';

export const opportunityTypeLabels: Record<OpportunityType, string> = {
  'split-large-component': 'Split Large Component',
  'extract-hook': 'Extract Custom Hook',
  'extract-service-layer': 'Extract Service Layer',
  'deduplicate-logic': 'Deduplicate Logic',
  'simplify-complex-function': 'Simplify Complex Function',
  'improve-module-boundaries': 'Improve Module Boundaries',
  'add-tests-before-refactor': 'Add Tests Before Refactor',
  'remove-dead-code': 'Remove Dead or Suspicious Code',
};
