import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
  type ArrowFunction,
  type CallExpression,
  type FunctionDeclaration,
  type FunctionExpression,
  type MethodDeclaration,
} from 'ts-morph';
import type {
  ApiCallEvidence,
  CodeLanguage,
  CodeSignal,
  FileAnalysis,
  FunctionAnalysis,
  RefactorCoachConfig,
  ResponsibilityTag,
} from '../core/types.js';
import { hasNearbyTest } from './testCoverageAnalyzer.js';
import { isTestFile, relativeToRoot } from '../utils/pathUtils.js';

type SupportedFunctionNode =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

type ImportMap = Map<string, string>;

export function analyzeFile(
  project: Project,
  rootPath: string,
  filePath: string,
  allFiles: string[],
  config: RefactorCoachConfig,
): FileAnalysis {
  const content = readFileSync(filePath, 'utf8');
  const relativePath = relativeToRoot(rootPath, filePath);
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });
  const importMap = buildImportMap(sourceFile);
  const apiCalls = collectApiCallEvidence(sourceFile, importMap);
  const functions = analyzeFunctions(sourceFile, importMap);
  const responsibilities = detectResponsibilities(sourceFile, content, filePath, apiCalls);
  const lineCount = countLines(content);
  const hookCount = countHookCalls(sourceFile);
  const todoCount = countTodos(content);
  const componentCount = functions.filter((fn) => fn.returnsJsx && /^[A-Z]/.test(fn.name)).length;
  const signals = buildSignals({
    config,
    content,
    filePath: relativePath,
    functions,
    hookCount,
    lineCount,
    responsibilities,
    sourceFile,
    todoCount,
    apiCalls,
  });

  return {
    path: relativePath,
    absolutePath: filePath,
    language: detectLanguage(filePath),
    lineCount,
    importCount: sourceFile.getImportDeclarations().length,
    exportCount: countExports(sourceFile),
    functionCount: functions.length,
    componentCount,
    hookCount,
    hasTestsNearby: hasNearbyTest(filePath, allFiles),
    todoCount,
    complexityScore: calculateFileComplexityScore(functions, responsibilities, lineCount),
    responsibilities,
    signals,
    functions,
    importSources: sourceFile
      .getImportDeclarations()
      .map((declaration) => declaration.getModuleSpecifierValue()),
    dependentCount: 0,
  };
}

function analyzeFunctions(sourceFile: SourceFile, importMap: ImportMap): FunctionAnalysis[] {
  const functions: FunctionAnalysis[] = [];

  sourceFile.forEachDescendant((node) => {
    if (!isSupportedFunctionNode(node)) return;

    const start = sourceFile.getLineAndColumnAtPos(node.getStart());
    const end = sourceFile.getLineAndColumnAtPos(node.getEnd());
    const lineCount = Math.max(1, end.line - start.line + 1);
    const hasTryCatch = node.getDescendantsOfKind(SyntaxKind.TryStatement).length > 0;
    const tryCatchLineCount = sumTryCatchLineCounts(sourceFile, node);
    const apiCalls = collectApiCallEvidence(node, importMap, sourceFile);

    functions.push({
      name: getFunctionName(node, start.line),
      startLine: start.line,
      endLine: end.line,
      lineCount,
      parameterCount: node.getParameters().length,
      isAsync: node.isAsync(),
      hasTryCatch,
      tryCatchLineCount,
      conditionalCount: countConditionalNodes(node),
      maxConditionalDepth: getMaxConditionalDepth(node),
      cyclomaticComplexity: estimateCyclomaticComplexity(node),
      hookCount: countHookCalls(node),
      apiCallCount: apiCalls.length,
      apiCalls,
      returnsJsx: returnsJsx(node),
      bodyHash: lineCount >= 8 ? hashFunctionBody(node.getText()) : undefined,
    });
  });

  return functions;
}

function isSupportedFunctionNode(node: Node): node is SupportedFunctionNode {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node)
  );
}

function getFunctionName(node: SupportedFunctionNode, line: number): string {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    return node.getName() ?? `anonymous_line_${line}`;
  }

  const parent = node.getParent();
  if (Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }

  if (Node.isPropertyAssignment(parent)) {
    return parent.getName();
  }

  return `anonymous_line_${line}`;
}

function returnsJsx(node: Node): boolean {
  if (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node) || Node.isJsxFragment(node)) {
    return true;
  }

  return node
    .getDescendants()
    .some(
      (descendant) =>
        Node.isJsxElement(descendant) ||
        Node.isJsxSelfClosingElement(descendant) ||
        Node.isJsxFragment(descendant),
    );
}

function countHookCalls(node: Node): number {
  return node.getDescendantsOfKind(SyntaxKind.CallExpression).filter((callExpression) => {
    const expression = callExpression.getExpression().getText();
    return /^use[A-Z0-9]/.test(expression) || expression.includes('.use');
  }).length;
}

function buildImportMap(sourceFile: SourceFile): ImportMap {
  const importMap: ImportMap = new Map();

  for (const declaration of sourceFile.getImportDeclarations()) {
    const source = declaration.getModuleSpecifierValue();
    const defaultImport = declaration.getDefaultImport();
    const namespaceImport = declaration.getNamespaceImport();

    if (defaultImport) {
      importMap.set(defaultImport.getText(), source);
    }

    if (namespaceImport) {
      importMap.set(namespaceImport.getText(), source);
    }

    for (const namedImport of declaration.getNamedImports()) {
      importMap.set(namedImport.getAliasNode()?.getText() ?? namedImport.getName(), source);
    }
  }

  return importMap;
}

function collectApiCallEvidence(
  node: Node,
  importMap: ImportMap,
  sourceFile = node.getSourceFile(),
): ApiCallEvidence[] {
  const evidence: ApiCallEvidence[] = [];

  for (const callExpression of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const apiCall = getApiCallEvidence(callExpression, importMap, sourceFile);
    if (apiCall) {
      evidence.push(apiCall);
    }
  }

  return evidence;
}

function getApiCallEvidence(
  callExpression: CallExpression,
  importMap: ImportMap,
  sourceFile: SourceFile,
): ApiCallEvidence | undefined {
  const expression = callExpression.getExpression();
  const expressionText = expression.getText();
  const line = sourceFile.getLineAndColumnAtPos(callExpression.getStart()).line;

  if (Node.isIdentifier(expression)) {
    const name = expression.getText();
    if (name === 'fetch' || name === 'request') {
      return { expression: expressionText, kind: 'network-call', line };
    }

    const importSource = importMap.get(name);
    if (importSource && isServiceImport(importSource)) {
      return { expression: expressionText, kind: 'service-call', line, importSource };
    }

    if (['useQuery', 'useMutation', 'useSWR'].includes(name)) {
      return { expression: expressionText, kind: 'data-hook', line, importSource };
    }

    return undefined;
  }

  if (!Node.isPropertyAccessExpression(expression)) {
    return undefined;
  }

  const methodName = expression.getName();
  const receiver = getRootIdentifier(expression);
  const importSource = receiver ? importMap.get(receiver) : undefined;

  if (!receiver) {
    return undefined;
  }

  if (['then', 'catch', 'finally'].includes(methodName)) {
    return undefined;
  }

  if (receiver === 'supabase') {
    if (methodName === 'from') {
      return undefined;
    }
    return { expression: expressionText, kind: 'client-call', line, receiver, importSource };
  }

  if (receiver === 'axios' || receiver === 'ky') {
    return { expression: expressionText, kind: 'network-call', line, receiver, importSource };
  }

  if (importSource && isServiceImport(importSource)) {
    return { expression: expressionText, kind: 'service-call', line, receiver, importSource };
  }

  if (
    ['get', 'post', 'put', 'patch', 'delete', 'request'].includes(methodName) &&
    isLikelyApiClient(receiver, importSource)
  ) {
    return { expression: expressionText, kind: 'client-call', line, receiver, importSource };
  }

  return undefined;
}

function getRootIdentifier(expression: Node): string | undefined {
  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }

  if (Node.isPropertyAccessExpression(expression)) {
    return getRootIdentifier(expression.getExpression());
  }

  if (Node.isCallExpression(expression)) {
    return getRootIdentifier(expression.getExpression());
  }

  return undefined;
}

function isServiceImport(importSource: string): boolean {
  return (
    /(^|\/)(api|services?)$/.test(importSource) ||
    /(^|\/)(api|services?)\//.test(importSource) ||
    (importSource.includes('/features/') && importSource.endsWith('/api'))
  );
}

function isLikelyApiClient(receiver: string, importSource: string | undefined): boolean {
  if (/^(api|apiClient|http|httpClient|client|request|axios|ky|trpc)$/i.test(receiver)) {
    return true;
  }

  return Boolean(importSource && /(^|\/)(api|services?|client|http)(\/|$)/.test(importSource));
}

function sumTryCatchLineCounts(sourceFile: SourceFile, node: Node): number {
  return node.getDescendantsOfKind(SyntaxKind.TryStatement).reduce((total, tryStatement) => {
    const start = sourceFile.getLineAndColumnAtPos(tryStatement.getStart()).line;
    const end = sourceFile.getLineAndColumnAtPos(tryStatement.getEnd()).line;
    return total + Math.max(1, end - start + 1);
  }, 0);
}

function countConditionalNodes(node: Node): number {
  return node
    .getDescendants()
    .filter(
      (descendant) =>
        Node.isIfStatement(descendant) ||
        Node.isConditionalExpression(descendant) ||
        Node.isSwitchStatement(descendant),
    ).length;
}

function getMaxConditionalDepth(node: Node): number {
  let maxDepth = 0;

  const visit = (current: Node, depth: number): void => {
    const nextDepth = isDecisionNode(current) ? depth + 1 : depth;
    maxDepth = Math.max(maxDepth, nextDepth);
    current.forEachChild((child) => visit(child, nextDepth));
  };

  visit(node, 0);
  return maxDepth;
}

function estimateCyclomaticComplexity(node: Node): number {
  let complexity = 1;

  node.forEachDescendant((descendant) => {
    if (isDecisionNode(descendant) || Node.isCatchClause(descendant)) {
      complexity += 1;
    }

    if (Node.isBinaryExpression(descendant)) {
      const operator = descendant.getOperatorToken().getText();
      if (operator === '&&' || operator === '||' || operator === '??') {
        complexity += 1;
      }
    }
  });

  return complexity;
}

function isDecisionNode(node: Node): boolean {
  return (
    Node.isIfStatement(node) ||
    Node.isConditionalExpression(node) ||
    Node.isForStatement(node) ||
    Node.isForInStatement(node) ||
    Node.isForOfStatement(node) ||
    Node.isWhileStatement(node) ||
    Node.isDoStatement(node) ||
    Node.isCaseClause(node) ||
    Node.isSwitchStatement(node)
  );
}

function hashFunctionBody(text: string): string {
  const normalized = text
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return createHash('sha1').update(normalized).digest('hex');
}

function detectResponsibilities(
  sourceFile: SourceFile,
  content: string,
  filePath: string,
  apiCalls: ApiCallEvidence[],
): ResponsibilityTag[] {
  const tags = new Set<ResponsibilityTag>();
  const lowerContent = content.toLowerCase();

  if (isTestFile(filePath)) tags.add('testing');
  if (/\.(tsx|jsx)$/.test(filePath) || returnsJsx(sourceFile)) tags.add('ui');
  if (/\b(useState|useReducer|useEffect|useMemo|useCallback|zustand|redux|jotai)\b/.test(content)) {
    tags.add('state');
  }
  if (apiCalls.length > 0) {
    tags.add('data-fetching');
  }
  if (/\b(validate|schema|zod|yup|joi|parse|safeParse|required)\b/i.test(content)) {
    tags.add('validation');
  }
  if (/\b(prisma|drizzle|mongoose|sequelize|typeorm|sql`|db\.)\b/i.test(content)) {
    tags.add('database');
  }
  if (/\b(auth|session|jwt|token|permission|role|login|logout)\b/i.test(content)) {
    tags.add('auth');
  }
  if (
    /\b(useRouter|router\.|redirect\(|navigate\(|react-router|next\/navigation)\b/.test(content)
  ) {
    tags.add('routing');
  }
  if (/\b(className|style=|styled\.|css`|sx=|tailwind|styles\.)\b/.test(content)) {
    tags.add('styling');
  }
  if (
    sourceFile.getFunctions().length > 0 ||
    /\b(map|filter|reduce|sort|calculate|compute|transform|normalize)\b/.test(lowerContent)
  ) {
    tags.add('business-logic');
  }

  return Array.from(tags).sort();
}

function buildSignals(input: {
  config: RefactorCoachConfig;
  content: string;
  filePath: string;
  functions: FunctionAnalysis[];
  hookCount: number;
  lineCount: number;
  responsibilities: ResponsibilityTag[];
  sourceFile: SourceFile;
  todoCount: number;
  apiCalls: ApiCallEvidence[];
}): CodeSignal[] {
  const signals: CodeSignal[] = [];
  const {
    config,
    content,
    filePath,
    functions,
    hookCount,
    lineCount,
    responsibilities,
    sourceFile,
    todoCount,
    apiCalls,
  } = input;

  if (lineCount >= config.thresholds.largeFileLines) {
    signals.push({
      type: 'large-file',
      message: `File has ${lineCount} lines.`,
      severity: lineCount >= config.thresholds.largeFileLines * 1.5 ? 'high' : 'medium',
      location: { file: filePath },
      metadata: { lineCount },
    });
  }

  if (todoCount > 0) {
    signals.push({
      type: 'todo-comments',
      message: `File contains ${todoCount} TODO/FIXME/HACK comment${todoCount === 1 ? '' : 's'}.`,
      severity: todoCount >= 3 ? 'medium' : 'low',
      location: { file: filePath },
      metadata: { todoCount },
    });
  }

  if (responsibilities.length >= config.thresholds.maxResponsibilities) {
    signals.push({
      type: 'mixed-responsibilities',
      message: `File appears to combine ${responsibilities.join(', ')} responsibilities.`,
      severity: responsibilities.length >= 5 ? 'high' : 'medium',
      location: { file: filePath },
      metadata: { responsibilities },
    });
  }

  if (hookCount > config.thresholds.maxHooksInComponent && returnsJsx(sourceFile)) {
    signals.push({
      type: 'too-many-hooks',
      message: `React file uses ${hookCount} hooks.`,
      severity: hookCount > config.thresholds.maxHooksInComponent * 1.5 ? 'high' : 'medium',
      location: { file: filePath },
      metadata: { hookCount },
    });
  }

  if (returnsJsx(sourceFile) && apiCalls.length > 0) {
    const hasOnlyServiceCalls = apiCalls.every((apiCall) => apiCall.kind === 'service-call');
    signals.push({
      type: 'api-calls-in-ui',
      message: hasOnlyServiceCalls
        ? 'UI file calls data/service functions directly.'
        : 'UI file appears to perform network or client calls directly.',
      severity: 'medium',
      location: { file: filePath },
      metadata: { apiCallCount: apiCalls.length, apiCalls: apiCalls.slice(0, 8) },
    });
  }

  if (/\bstyle=\{\{/.test(content)) {
    signals.push({
      type: 'inline-styles',
      message: 'File contains inline style objects.',
      severity: 'low',
      location: { file: filePath },
    });
  }

  for (const fn of functions) {
    if (
      fn.lineCount >= config.thresholds.complexFunctionLines ||
      fn.cyclomaticComplexity >= config.thresholds.complexFunctionComplexity ||
      fn.parameterCount > config.thresholds.maxFunctionParams ||
      fn.maxConditionalDepth >= 3
    ) {
      signals.push({
        type: 'complex-function',
        message: `${fn.name} is complex (${fn.lineCount} lines, complexity ${fn.cyclomaticComplexity}).`,
        severity:
          fn.cyclomaticComplexity >= config.thresholds.complexFunctionComplexity * 1.5
            ? 'high'
            : 'medium',
        location: { file: filePath, line: fn.startLine },
        metadata: {
          name: fn.name,
          lineCount: fn.lineCount,
          parameterCount: fn.parameterCount,
          cyclomaticComplexity: fn.cyclomaticComplexity,
          maxConditionalDepth: fn.maxConditionalDepth,
        },
      });
    }

    if (fn.tryCatchLineCount >= 40) {
      signals.push({
        type: 'large-try-catch',
        message: `${fn.name} has a large try/catch block.`,
        severity: 'medium',
        location: { file: filePath, line: fn.startLine },
        metadata: { name: fn.name, tryCatchLineCount: fn.tryCatchLineCount },
      });
    }

    if (fn.isAsync && fn.apiCallCount > 0 && !fn.hasTryCatch) {
      signals.push({
        type: 'async-without-error-handling',
        message: `${fn.name} performs async work without obvious try/catch error handling.`,
        severity: 'medium',
        location: { file: filePath, line: fn.startLine },
        metadata: { name: fn.name },
      });
    }
  }

  return signals;
}

function countLines(content: string): number {
  if (content.trim().length === 0) {
    return 0;
  }

  return content.split(/\r?\n/).length;
}

function countTodos(content: string): number {
  return (content.match(/\b(TODO|FIXME|HACK)\b/gi) ?? []).length;
}

function countExports(sourceFile: SourceFile): number {
  let count = 0;

  sourceFile.forEachChild((node) => {
    if (
      Node.isExportDeclaration(node) ||
      Node.isExportAssignment(node) ||
      hasTopLevelExportKeyword(node)
    ) {
      count += 1;
    }
  });

  return Math.max(count, sourceFile.getExportedDeclarations().size);
}

function hasTopLevelExportKeyword(node: Node): boolean {
  return (
    (Node.isVariableStatement(node) ||
      Node.isFunctionDeclaration(node) ||
      Node.isClassDeclaration(node) ||
      Node.isInterfaceDeclaration(node) ||
      Node.isTypeAliasDeclaration(node) ||
      Node.isEnumDeclaration(node)) &&
    node.hasExportKeyword()
  );
}

function calculateFileComplexityScore(
  functions: FunctionAnalysis[],
  responsibilities: ResponsibilityTag[],
  lineCount: number,
): number {
  const functionComplexity = functions.reduce((sum, fn) => sum + fn.cyclomaticComplexity, 0);
  const sizePenalty = Math.floor(lineCount / 100);
  const responsibilityPenalty = Math.max(0, responsibilities.length - 2) * 2;
  return functionComplexity + sizePenalty + responsibilityPenalty;
}

function detectLanguage(filePath: string): CodeLanguage {
  const extension = path.extname(filePath);
  if (extension === '.ts' || extension === '.tsx') return 'typescript';
  if (extension === '.js' || extension === '.jsx') return 'javascript';
  return 'unknown';
}
