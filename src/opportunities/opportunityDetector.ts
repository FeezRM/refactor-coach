import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CodeSignal,
  FileAnalysis,
  FunctionAnalysis,
  OpportunityType,
  RefactorCoachConfig,
  RefactorOpportunity,
} from '../core/types.js';
import { scoreOpportunity } from './scoring.js';
import { opportunityTypeLabels } from './opportunityTypes.js';

type DraftOpportunity = Omit<
  RefactorOpportunity,
  'id' | 'impact' | 'risk' | 'confidence' | 'priority' | 'priorityLabel'
> & {
  signalStrength: number;
  fileAnalyses: FileAnalysis[];
};

type FinalOpportunity = Omit<RefactorOpportunity, 'id'>;

export function detectOpportunities(
  files: FileAnalysis[],
  config: RefactorCoachConfig,
): RefactorOpportunity[] {
  const drafts: DraftOpportunity[] = [];

  for (const file of files) {
    const skipLowValueTestFile = file.responsibilities.includes('testing') && file.lineCount < 300;
    const largeComponentFunctions = file.functions.filter(
      (fn) => fn.returnsJsx && fn.lineCount >= config.thresholds.largeComponentLines,
    );

    if (skipLowValueTestFile) {
      continue;
    }

    if (
      largeComponentFunctions.length > 0 ||
      (file.componentCount > 0 && file.lineCount >= config.thresholds.largeComponentLines)
    ) {
      drafts.push(createSplitLargeComponentOpportunity(file, largeComponentFunctions));
    }

    if (file.signals.some((signal) => signal.type === 'too-many-hooks')) {
      drafts.push(createExtractHookOpportunity(file));
    }

    if (file.signals.some((signal) => signal.type === 'api-calls-in-ui')) {
      drafts.push(createExtractServiceLayerOpportunity(file));
    }

    const complexFunctions = file.functions.filter(
      (fn) =>
        fn.lineCount >= config.thresholds.complexFunctionLines ||
        fn.cyclomaticComplexity >= config.thresholds.complexFunctionComplexity ||
        fn.parameterCount > config.thresholds.maxFunctionParams ||
        fn.maxConditionalDepth >= 3,
    );

    for (const fn of complexFunctions.slice(0, 3)) {
      drafts.push(createSimplifyComplexFunctionOpportunity(file, fn));
    }

    if (file.signals.some((signal) => signal.type === 'mixed-responsibilities')) {
      drafts.push(createImproveBoundariesOpportunity(file));
    }

    if (
      !file.hasTestsNearby &&
      !file.responsibilities.includes('testing') &&
      (file.complexityScore >= 15 ||
        file.lineCount >= config.thresholds.largeFileLines ||
        complexFunctions.length > 0 ||
        file.responsibilities.includes('auth') ||
        file.responsibilities.includes('database'))
    ) {
      drafts.push(createAddTestsOpportunity(file, complexFunctions[0]));
    }

    if (file.todoCount > 0) {
      drafts.push(createSuspiciousCodeOpportunity(file));
    }
  }

  drafts.push(...createDuplicateLogicOpportunities(files));

  return drafts
    .map((draft) => finalizeDraft(draft))
    .sort((a, b) => b.priority - a.priority || b.impact - a.impact)
    .map((opportunity, index) => ({ ...opportunity, id: String(index + 1) }));
}

function finalizeDraft(draft: DraftOpportunity): FinalOpportunity {
  const { signalStrength, fileAnalyses, ...rest } = draft;
  const scores = scoreOpportunity(rest.type, fileAnalyses, signalStrength);
  return {
    ...rest,
    ...scores,
  };
}

function createSplitLargeComponentOpportunity(
  file: FileAnalysis,
  componentFunctions: FunctionAnalysis[],
): DraftOpportunity {
  const componentName = componentFunctions[0]?.name ?? getPrimarySymbolName(file);
  return {
    type: 'split-large-component',
    title: `Split Large ${componentName} Component`,
    files: [file.path],
    explanation:
      'This React file is large enough that rendering, state, data shaping, and event handling are likely competing in one place. Splitting it into smaller components and hooks should make changes easier to review and test.',
    suggestedSteps: [
      'Identify independent UI regions and extract the lowest-risk presentational component first.',
      'Move stateful or data-loading logic into a named custom hook only after current behavior is covered.',
      'Keep the original component as a composition layer so props and visible behavior stay stable.',
    ],
    testsToAdd: file.hasTestsNearby
      ? ['Extend the existing component test around the UI behavior being extracted.']
      : ['Add a render or behavior test for the component before splitting it.'],
    signals: file.signals.filter(
      (signal) => signal.type === 'large-file' || signal.type === 'complex-function',
    ),
    metadata: {
      componentName,
      componentLines: componentFunctions[0]?.lineCount ?? file.lineCount,
    },
    signalStrength: componentFunctions.length > 0 ? 3 : 2,
    fileAnalyses: [file],
  };
}

function createExtractHookOpportunity(file: FileAnalysis): DraftOpportunity {
  const displayName = getPrimarySymbolName(file);
  return {
    type: 'extract-hook',
    title: `Extract Hook From ${displayName}`,
    files: [file.path],
    explanation:
      'This component uses enough hooks that state transitions, effects, and rendering are probably tightly coupled. Extracting a focused hook can isolate behavior while keeping the UI component easier to scan.',
    suggestedSteps: [
      'Group related state, effects, and derived values by responsibility.',
      'Extract one cohesive group into a `useX` hook with a small return shape.',
      'Leave JSX and styling in the component; keep the hook free of rendering concerns.',
    ],
    testsToAdd: file.hasTestsNearby
      ? ['Cover the state/effect behavior that will move into the hook.']
      : ['Add a component behavior test or hook test before moving stateful logic.'],
    signals: file.signals.filter((signal) => signal.type === 'too-many-hooks'),
    signalStrength: 3,
    fileAnalyses: [file],
  };
}

function createExtractServiceLayerOpportunity(file: FileAnalysis): DraftOpportunity {
  const displayName = getPrimarySymbolName(file);
  const apiSignal = file.signals.find((signal) => signal.type === 'api-calls-in-ui');
  const hasOnlyServiceCalls =
    Array.isArray(apiSignal?.metadata?.apiCalls) &&
    apiSignal.metadata.apiCalls.every(
      (apiCall) =>
        typeof apiCall === 'object' &&
        apiCall !== null &&
        'kind' in apiCall &&
        apiCall.kind === 'service-call',
    );
  return {
    type: 'extract-service-layer',
    title: hasOnlyServiceCalls
      ? `Move Data Loading Out Of ${displayName}`
      : `Move API Calls Out Of ${displayName}`,
    files: [file.path],
    explanation: hasOnlyServiceCalls
      ? 'The UI calls data/service functions directly. Moving loading orchestration into a hook can keep data state and rendering concerns easier to test independently.'
      : 'The UI appears to perform network or request work directly. Moving request code into a service or API module makes the component easier to test and keeps transport details out of rendering code.',
    suggestedSteps: [
      hasOnlyServiceCalls
        ? 'Identify service/data calls and the loading, error, and refresh state coupled to them.'
        : 'Identify fetch, client, or request calls inside the UI file.',
      hasOnlyServiceCalls
        ? 'Extract a focused hook that owns the service calls and exposes a small state/action surface.'
        : 'Create or reuse a service module for the request and response normalization.',
      'Update the component to consume the extracted boundary without changing visible behavior.',
    ],
    testsToAdd: file.hasTestsNearby
      ? ['Mock the service boundary in the existing UI test.']
      : ['Add a smoke test for loading, success, and error UI states before extracting requests.'],
    signals: file.signals.filter((signal) => signal.type === 'api-calls-in-ui'),
    signalStrength: 3,
    fileAnalyses: [file],
  };
}

function createSimplifyComplexFunctionOpportunity(
  file: FileAnalysis,
  fn: FunctionAnalysis,
): DraftOpportunity {
  return {
    type: 'simplify-complex-function',
    title: `Simplify ${fn.name}`,
    files: [file.path],
    explanation:
      'This function is long or branch-heavy enough that it is hard to reason about all paths at once. Smaller helpers and guard clauses can reduce local complexity without changing public behavior.',
    suggestedSteps: [
      'Add characterization coverage for the important branches before changing structure.',
      'Extract pure helper functions for repeated decisions or transformations.',
      'Prefer guard clauses to reduce nesting, and keep function inputs and outputs unchanged.',
    ],
    testsToAdd: file.hasTestsNearby
      ? [`Add branch-focused cases for \`${fn.name}\`.`]
      : [`Add characterization tests for \`${fn.name}\` before refactoring.`],
    signals: file.signals.filter(
      (signal) => signal.type === 'complex-function' && signal.metadata?.name === fn.name,
    ),
    metadata: {
      functionName: fn.name,
      startLine: fn.startLine,
      lineCount: fn.lineCount,
      cyclomaticComplexity: fn.cyclomaticComplexity,
    },
    signalStrength: fn.cyclomaticComplexity >= 18 || fn.lineCount >= 100 ? 3 : 2,
    fileAnalyses: [file],
  };
}

function createImproveBoundariesOpportunity(file: FileAnalysis): DraftOpportunity {
  const displayName = getPrimarySymbolName(file);
  return {
    type: 'improve-module-boundaries',
    title: `Clarify Responsibilities In ${displayName}`,
    files: [file.path],
    explanation:
      'This file appears to combine several responsibilities. Clearer module boundaries reduce the chance that a UI, data, validation, or state change accidentally affects unrelated behavior.',
    suggestedSteps: [
      'List the responsibilities currently present in the file.',
      'Extract the responsibility with the smallest external surface first.',
      'Keep public imports stable until tests prove the boundary change is safe.',
    ],
    testsToAdd: file.hasTestsNearby
      ? ['Keep existing tests passing and add coverage around the extracted boundary.']
      : ['Add tests around the behavior owned by each responsibility before moving code.'],
    signals: file.signals.filter((signal) => signal.type === 'mixed-responsibilities'),
    metadata: { responsibilities: file.responsibilities },
    signalStrength: Math.min(4, file.responsibilities.length - 1),
    fileAnalyses: [file],
  };
}

function createAddTestsOpportunity(
  file: FileAnalysis,
  complexFunction?: FunctionAnalysis,
): DraftOpportunity {
  const focus = complexFunction ? `\`${complexFunction.name}\`` : `\`${file.path}\``;
  const displayName = getPrimarySymbolName(file);
  return {
    type: 'add-tests-before-refactor',
    title: `Add Tests Before Refactoring ${displayName}`,
    files: [file.path],
    explanation:
      'This area has enough complexity or sensitivity that changing structure without tests would be risky. Characterization tests should lock down current behavior before any extraction work starts.',
    suggestedSteps: [
      `Add focused tests around ${focus} and the most important user-visible or data behavior.`,
      'Cover success, failure, and edge-case branches that are easy to break during extraction.',
      'Run the test suite before starting any structural refactor.',
    ],
    testsToAdd: [
      complexFunction
        ? `Characterization tests for \`${complexFunction.name}\` branches.`
        : 'Characterization tests for current file behavior.',
    ],
    signals: file.signals.filter((signal) =>
      ['complex-function', 'large-file', 'mixed-responsibilities'].includes(signal.type),
    ),
    metadata: {
      targetRisk: 'high',
      complexityScore: file.complexityScore,
    },
    signalStrength: 3,
    fileAnalyses: [file],
  };
}

function createSuspiciousCodeOpportunity(file: FileAnalysis): DraftOpportunity {
  return {
    type: 'remove-dead-code',
    title: `Review TODOs In ${stripExtension(path.basename(file.path))}`,
    files: [file.path],
    explanation:
      'TODO, FIXME, or HACK comments are signs that code may contain unfinished decisions or temporary workarounds. These should be triaged before broader refactors rely on them.',
    suggestedSteps: [
      'Review each TODO/FIXME/HACK and decide whether it is still relevant.',
      'Convert real follow-up work into tracked issues or small code changes.',
      'Remove stale comments only after confirming the surrounding behavior is still needed.',
    ],
    testsToAdd: file.hasTestsNearby
      ? ['Run nearby tests before removing or changing suspicious code.']
      : ['Add a focused test if the comment points at risky behavior.'],
    signals: file.signals.filter((signal) => signal.type === 'todo-comments'),
    signalStrength: file.todoCount >= 3 ? 2 : 1,
    fileAnalyses: [file],
  };
}

function createDuplicateLogicOpportunities(files: FileAnalysis[]): DraftOpportunity[] {
  const byHash = new Map<string, Array<{ file: FileAnalysis; fn: FunctionAnalysis }>>();

  for (const file of files) {
    for (const fn of file.functions) {
      if (!fn.bodyHash || fn.lineCount < 8) continue;
      const existing = byHash.get(fn.bodyHash) ?? [];
      existing.push({ file, fn });
      byHash.set(fn.bodyHash, existing);
    }
  }

  return Array.from(byHash.values())
    .filter((matches) => new Set(matches.map((match) => match.file.path)).size > 1)
    .slice(0, 10)
    .flatMap((matches) => {
      const filesInvolved = unique(matches.map((match) => match.file));
      const functionNames = unique(matches.map((match) => match.fn.name));
      const duplicateKind = inferDuplicateKind(matches);
      if (!duplicateKind && functionNames.every((name) => name.startsWith('anonymous_line_'))) {
        return [];
      }
      const displayName = duplicateKind?.titleLabel ?? functionNames[0] ?? 'Shared';
      const helperName = duplicateKind?.helperName ?? `extract${toPascalCase(displayName)}Helper`;
      const suggestedHelperPath = inferSharedHelperPath(filesInvolved, helperName);
      const maxDuplicateLines = Math.max(...matches.map((match) => match.fn.lineCount));
      const signals: CodeSignal[] = matches.map((match) => ({
        type: 'duplicate-function-body',
        message: `${match.fn.name} appears to duplicate ${displayName} logic found in another file.`,
        severity: 'medium',
        location: { file: match.file.path, line: match.fn.startLine },
        metadata: {
          functionName: match.fn.name,
          duplicateLineCount: match.fn.lineCount,
          helperName,
          suggestedHelperPath,
        },
      }));

      return [{
        type: 'deduplicate-logic',
        title: duplicateKind?.title ?? `Deduplicate ${displayName} Logic`,
        files: filesInvolved.map((file) => file.path),
        explanation:
          'The scanner found matching function bodies in multiple files. Extracting shared logic can reduce maintenance cost, but the existing call sites should be covered before changing imports.',
        suggestedSteps: [
          'Compare the duplicated functions and confirm they are intentionally equivalent.',
          'Add tests around at least one current call site before extracting a shared helper.',
          'Move the shared behavior into a utility module and update one call site at a time.',
        ],
        testsToAdd: ['Characterization tests for the duplicated behavior before extraction.'],
        signals,
        metadata: { functionNames, helperName, suggestedHelperPath, maxDuplicateLines },
        signalStrength: maxDuplicateLines >= 25 || matches.length >= 3 ? 3 : 1,
        fileAnalyses: filesInvolved,
      } satisfies DraftOpportunity];
    });
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function getPrimarySymbolName(file: FileAnalysis): string {
  const component = file.functions.find((fn) => fn.returnsJsx && /^[A-Z]/.test(fn.name));
  if (component) {
    return component.name;
  }

  const meaningfulFunction = file.functions
    .filter((fn) => !fn.name.startsWith('anonymous_line_'))
    .sort(
      (a, b) => b.lineCount - a.lineCount || b.cyclomaticComplexity - a.cyclomaticComplexity,
    )[0];
  if (meaningfulFunction) {
    return meaningfulFunction.name;
  }

  const basename = stripExtension(path.basename(file.path));
  const parent = path.basename(path.dirname(file.path));
  return basename === 'index' && parent ? `${toPascalCase(parent)}Index` : toPascalCase(basename);
}

function inferDuplicateKind(matches: Array<{ file: FileAnalysis; fn: FunctionAnalysis }>):
  | {
      title: string;
      titleLabel: string;
      helperName: string;
    }
  | undefined {
  const combinedSnippet = matches
    .map((match) => readFunctionSnippet(match.file, match.fn))
    .join('\n');
  if (
    /XMLHttpRequest/.test(combinedSnippet) &&
    /responseType\s*=\s*['"]blob['"]/.test(combinedSnippet)
  ) {
    return {
      title: 'Extract Shared Local File Blob Reader',
      titleLabel: 'Local File Blob Reader',
      helperName: 'readLocalFileAsBlob',
    };
  }

  return undefined;
}

function readFunctionSnippet(file: FileAnalysis, fn: FunctionAnalysis): string {
  try {
    return readFileSync(file.absolutePath, 'utf8')
      .split(/\r?\n/)
      .slice(fn.startLine - 1, fn.endLine)
      .join('\n');
  } catch {
    return '';
  }
}

function inferSharedHelperPath(files: FileAnalysis[], helperName: string): string {
  const workspace = commonWorkspace(files);
  const language = files[0]?.language;
  const extension =
    language === 'python' ? 'py' : language === 'java' ? 'java' : language === 'javascript' ? 'js' : 'ts';
  const fileName =
    language === 'python'
      ? `${toSnakeCase(helperName)}.${extension}`
      : language === 'java'
        ? `${toPascalCase(helperName)}.${extension}`
        : `${helperName}.${extension}`;

  if (workspace) {
    const subdirectory = language === 'python' ? 'services' : 'lib';
    return `${workspace.rootPath}/src/${subdirectory}/${fileName}`;
  }

  const commonDirectory = commonPathPrefix(files.map((file) => path.dirname(file.path)));
  return `${commonDirectory || 'src'}/${fileName}`;
}

function commonWorkspace(files: FileAnalysis[]) {
  const firstWorkspace = files[0]?.workspace;
  if (!firstWorkspace) {
    return undefined;
  }

  return files.every((file) => file.workspace?.rootPath === firstWorkspace.rootPath)
    ? firstWorkspace
    : undefined;
}

function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  const splitPaths = paths.map((item) => item.split('/'));
  const prefix: string[] = [];

  for (let index = 0; index < splitPaths[0].length; index += 1) {
    const segment = splitPaths[0][index];
    if (splitPaths.every((item) => item[index] === segment)) {
      prefix.push(segment);
    } else {
      break;
    }
  }

  return prefix.join('/');
}

function toPascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
