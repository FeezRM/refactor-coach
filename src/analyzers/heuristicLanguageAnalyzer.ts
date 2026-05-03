import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  CodeLanguage,
  CodeSignal,
  FileAnalysis,
  FunctionAnalysis,
  RefactorCoachConfig,
  ResponsibilityTag,
} from '../core/types.js';
import { hasNearbyTest } from './testCoverageAnalyzer.js';
import { isTestFile, relativeToRoot } from '../utils/pathUtils.js';

type FunctionMatch = {
  name: string;
  startLine: number;
  parameterCount: number;
  indent?: number;
  braceDepth?: number;
};

export function analyzeHeuristicLanguageFile(
  rootPath: string,
  filePath: string,
  allFiles: string[],
  config: RefactorCoachConfig,
): FileAnalysis {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const relativePath = relativeToRoot(rootPath, filePath);
  const language = detectLanguage(filePath);
  const strippedContent = stripComments(content, language);
  const functions = analyzeFunctions(lines, language);
  const responsibilities = detectResponsibilities(strippedContent, filePath, language);
  const todoCount = countTodos(content);
  const signals = buildSignals({
    config,
    filePath: relativePath,
    lineCount: countLines(content),
    functions,
    responsibilities,
    todoCount,
  });

  return {
    path: relativePath,
    absolutePath: filePath,
    language,
    lineCount: countLines(content),
    importCount: countImports(lines, language),
    exportCount: countExports(lines, language),
    functionCount: functions.length,
    componentCount: 0,
    hookCount: 0,
    hasTestsNearby: hasNearbyTest(filePath, allFiles),
    todoCount,
    complexityScore: calculateComplexityScore(functions, responsibilities, countLines(content)),
    responsibilities,
    signals,
    functions,
    importSources: collectImportSources(lines, language),
    dependentCount: 0,
  };
}

function analyzeFunctions(lines: string[], language: CodeLanguage): FunctionAnalysis[] {
  const matches = findFunctionMatches(lines, language);

  return matches.map((match, index) => {
    const endLine = findFunctionEnd(lines, matches, match, index, language);
    const bodyLines = lines.slice(match.startLine - 1, endLine);
    const body = bodyLines.join('\n');
    const conditionalCount = countMatches(
      body,
      /\b(if|elif|else if|for|while|case|catch|except|switch)\b/g,
    );
    const cyclomaticComplexity =
      1 + conditionalCount + countMatches(body, /(&&|\|\||\band\b|\bor\b)/g);

    return {
      name: match.name,
      startLine: match.startLine,
      endLine,
      lineCount: Math.max(1, endLine - match.startLine + 1),
      parameterCount: match.parameterCount,
      isAsync: /\basync\b/.test(lines[match.startLine - 1] ?? ''),
      hasTryCatch: /\b(try|catch|except|finally)\b/.test(body),
      tryCatchLineCount: countTryCatchLines(bodyLines),
      conditionalCount,
      maxConditionalDepth: estimateMaxDepth(bodyLines, language),
      cyclomaticComplexity,
      hookCount: 0,
      apiCallCount: countApiCalls(body),
      apiCalls: [],
      returnsJsx: false,
      bodyHash: bodyLines.length >= 8 ? hashBody(body) : undefined,
    };
  });
}

function findFunctionMatches(lines: string[], language: CodeLanguage): FunctionMatch[] {
  const matches: FunctionMatch[] = [];
  let currentJavaType: string | undefined;

  lines.forEach((line, index) => {
    if (language === 'python') {
      const match = line.match(
        /^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?\s*:/,
      );
      if (match) {
        matches.push({
          name: match[2],
          startLine: index + 1,
          parameterCount: countParameters(match[3]),
          indent: match[1].length,
        });
      }
      return;
    }

    const typeMatch = line.match(/\b(?:class|record|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (typeMatch) {
      currentJavaType = typeMatch[1];
    }

    const normalizedLine = stripLeadingJavaAnnotations(line);
    if (/\b(class|record|interface|enum)\s+/.test(normalizedLine)) {
      return;
    }

    const constructorMatch = currentJavaType
      ? normalizedLine.match(
          new RegExp(
            `^\\s*(?:(?:public|private|protected)\\s+)?${escapeRegExp(currentJavaType)}\\s*\\(([^)]*)\\)\\s*(?:throws\\s+[^{}]+)?\\{`,
          ),
        )
      : undefined;
    if (constructorMatch) {
      matches.push({
        name: currentJavaType!,
        startLine: index + 1,
        parameterCount: countParameters(constructorMatch[1]),
        braceDepth: braceDepthBefore(lines, index),
      });
      return;
    }

    const javaMatch = normalizedLine.match(
      /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)*(?:<[^>]+>\s*)?(?:[\w$.[\]<>?,]+\s+)+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?:throws\s+[^{}]+)?\{/,
    );
    if (javaMatch && !['if', 'for', 'while', 'switch', 'catch'].includes(javaMatch[1])) {
      matches.push({
        name: javaMatch[1],
        startLine: index + 1,
        parameterCount: countParameters(javaMatch[2]),
        braceDepth: braceDepthBefore(lines, index),
      });
    }
  });

  return matches;
}

function findFunctionEnd(
  lines: string[],
  matches: FunctionMatch[],
  match: FunctionMatch,
  index: number,
  language: CodeLanguage,
): number {
  if (language === 'python') {
    const nextAtSameOrLowerIndent = lines.findIndex((line, lineIndex) => {
      if (lineIndex <= match.startLine - 1 || line.trim() === '') return false;
      const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
      return indent <= (match.indent ?? 0);
    });
    const nextFunction = matches[index + 1]?.startLine;
    const candidates = [
      nextAtSameOrLowerIndent > -1 ? nextAtSameOrLowerIndent : undefined,
      nextFunction ? nextFunction - 1 : undefined,
    ].filter((value): value is number => value !== undefined);
    return candidates.length > 0 ? Math.min(...candidates) : lines.length;
  }

  let depth = 0;
  for (let lineIndex = match.startLine - 1; lineIndex < lines.length; lineIndex += 1) {
    depth += countMatches(lines[lineIndex], /\{/g);
    depth -= countMatches(lines[lineIndex], /\}/g);
    if (lineIndex > match.startLine - 1 && depth <= 0) {
      return lineIndex + 1;
    }
  }

  return lines.length;
}

function detectResponsibilities(
  content: string,
  filePath: string,
  language: CodeLanguage,
): ResponsibilityTag[] {
  const tags = new Set<ResponsibilityTag>();
  if (isTestFile(filePath)) tags.add('testing');
  if (
    /\b(requests|httpx|aiohttp|urllib\.request|fetch|RestTemplate|WebClient|HttpClient|OkHttpClient|FeignClient)\b/.test(
      content,
    )
  ) {
    tags.add('data-fetching');
  }
  if (
    /\b(validate|schema|pydantic|BaseModel|Field|validator|marshmallow|javax\.validation|jakarta\.validation|required|Validated|Valid|NotNull|NotBlank|NotEmpty|Size|Pattern)\b/i.test(
      content,
    ) ||
    /@(Valid|Validated|NotNull|NotBlank|NotEmpty|Size|Pattern)\b/.test(content)
  ) {
    tags.add('validation');
  }
  if (
    /\b(sqlalchemy|django\.db|Session|Repository|CrudRepository|JpaRepository|EntityManager|JdbcTemplate|jdbc|database|query)\b/i.test(
      content,
    ) ||
    /@(Entity|Table|Repository)\b/.test(content)
  ) {
    tags.add('database');
  }
  if (/\b(auth|permission|jwt|token|login|logout|security|OAuth2PasswordBearer|Principal)\b/i.test(content)) {
    tags.add('auth');
  }
  if (
    /\b(route|router|APIRouter|Controller|RestController|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|Flask|FastAPI|Django)\b/.test(
      content,
    ) ||
    /@\w+\.(?:route|get|post|put|patch|delete)\s*\(/.test(content) ||
    /@(Controller|RestController|RequestMapping|GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b/.test(
      content,
    )
  ) {
    tags.add('routing');
  }
  if (/\b(if|for|while|switch|map|filter|reduce|calculate|compute|transform|normalize)\b/.test(content)) {
    tags.add('business-logic');
  }
  if (language === 'java' && /\bclass\s+[A-Z]/.test(content)) {
    tags.add('business-logic');
  }

  return Array.from(tags).sort();
}

function buildSignals(input: {
  config: RefactorCoachConfig;
  filePath: string;
  lineCount: number;
  functions: FunctionAnalysis[];
  responsibilities: ResponsibilityTag[];
  todoCount: number;
}): CodeSignal[] {
  const signals: CodeSignal[] = [];

  if (input.lineCount >= input.config.thresholds.largeFileLines) {
    signals.push({
      type: 'large-file',
      message: `File has ${input.lineCount} lines.`,
      severity: input.lineCount >= input.config.thresholds.largeFileLines * 1.5 ? 'high' : 'medium',
      location: { file: input.filePath },
      metadata: { lineCount: input.lineCount },
    });
  }

  if (input.todoCount > 0) {
    signals.push({
      type: 'todo-comments',
      message: `File contains ${input.todoCount} TODO/FIXME/HACK comment${input.todoCount === 1 ? '' : 's'}.`,
      severity: input.todoCount >= 3 ? 'medium' : 'low',
      location: { file: input.filePath },
      metadata: { todoCount: input.todoCount },
    });
  }

  if (input.responsibilities.length >= input.config.thresholds.maxResponsibilities) {
    signals.push({
      type: 'mixed-responsibilities',
      message: `File appears to combine ${input.responsibilities.join(', ')} responsibilities.`,
      severity: input.responsibilities.length >= 5 ? 'high' : 'medium',
      location: { file: input.filePath },
      metadata: { responsibilities: input.responsibilities },
    });
  }

  for (const fn of input.functions) {
    if (
      fn.lineCount >= input.config.thresholds.complexFunctionLines ||
      fn.cyclomaticComplexity >= input.config.thresholds.complexFunctionComplexity ||
      fn.parameterCount > input.config.thresholds.maxFunctionParams ||
      fn.maxConditionalDepth >= 3
    ) {
      signals.push({
        type: 'complex-function',
        message: `${fn.name} is complex (${fn.lineCount} lines, complexity ${fn.cyclomaticComplexity}).`,
        severity:
          fn.cyclomaticComplexity >= input.config.thresholds.complexFunctionComplexity * 1.5
            ? 'high'
            : 'medium',
        location: { file: input.filePath, line: fn.startLine },
        metadata: {
          name: fn.name,
          lineCount: fn.lineCount,
          parameterCount: fn.parameterCount,
          cyclomaticComplexity: fn.cyclomaticComplexity,
          maxConditionalDepth: fn.maxConditionalDepth,
        },
      });
    }
  }

  return signals;
}

function stripComments(content: string, language: CodeLanguage): string {
  if (language === 'python') {
    return content.replace(/#.*$/gm, '');
  }

  return content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function countImports(lines: string[], language: CodeLanguage): number {
  const pattern =
    language === 'python' ? /^\s*(import|from)\s+/ : /^\s*import\s+(?:static\s+)?[\w.*]+;/;
  return lines.filter((line) => pattern.test(line)).length;
}

function collectImportSources(lines: string[], language: CodeLanguage): string[] {
  if (language === 'python') {
    return lines
      .map((line) => line.match(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => match[1] ?? match[2]);
  }

  return lines
    .map((line) => line.match(/^\s*import\s+(?:static\s+)?([\w.*]+);/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[1]);
}

function countExports(lines: string[], language: CodeLanguage): number {
  if (language === 'python') {
    return lines.filter((line) => /^(?:async\s+)?def\s+|^class\s+/.test(line)).length;
  }

  return lines.filter((line) => /^\s*public\s+/.test(line)).length;
}

function countTodos(content: string): number {
  return (content.match(/\b(TODO|FIXME|HACK)\b/gi) ?? []).length;
}

function countLines(content: string): number {
  return content.trim().length === 0 ? 0 : content.split(/\r?\n/).length;
}

function countParameters(params: string): number {
  const trimmed = params.trim();
  if (!trimmed) return 0;
  return trimmed.split(',').filter((param) => param.trim() && param.trim() !== 'self').length;
}

function countTryCatchLines(lines: string[]): number {
  let inBlock = false;
  let count = 0;
  for (const line of lines) {
    if (/\b(try|catch|except|finally)\b/.test(line)) inBlock = true;
    if (inBlock) count += 1;
  }
  return count;
}

function estimateMaxDepth(lines: string[], language: CodeLanguage): number {
  if (language === 'python') {
    return Math.max(
      0,
      ...lines
        .filter((line) => /\b(if|elif|else|for|while|try|except)\b/.test(line))
        .map((line) => Math.floor((line.match(/^(\s*)/)?.[1].length ?? 0) / 2)),
    );
  }

  let depth = 0;
  let maxDepth = 0;
  for (const line of lines) {
    if (/\b(if|for|while|switch|try|catch)\b/.test(line)) {
      maxDepth = Math.max(maxDepth, depth + 1);
    }
    depth += countMatches(line, /\{/g);
    depth -= countMatches(line, /\}/g);
  }
  return maxDepth;
}

function braceDepthBefore(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).reduce((depth, line) => {
    return depth + countMatches(line, /\{/g) - countMatches(line, /\}/g);
  }, 0);
}

function calculateComplexityScore(
  functions: FunctionAnalysis[],
  responsibilities: ResponsibilityTag[],
  lineCount: number,
): number {
  const functionComplexity = functions.reduce((sum, fn) => sum + fn.cyclomaticComplexity, 0);
  return functionComplexity + Math.floor(lineCount / 100) + Math.max(0, responsibilities.length - 2) * 2;
}

function hashBody(body: string): string {
  const normalized = body
    .replace(/#.*$/gm, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha1').update(normalized).digest('hex');
}

function countMatches(value: string, pattern: RegExp): number {
  return (value.match(pattern) ?? []).length;
}

function countApiCalls(value: string): number {
  return countMatches(
    value,
    /\b(requests|httpx|aiohttp|urllib\.request|fetch|RestTemplate|WebClient|HttpClient|OkHttpClient|FeignClient)\b/g,
  );
}

function stripLeadingJavaAnnotations(line: string): string {
  return line.replace(/^\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectLanguage(filePath: string): CodeLanguage {
  const extension = path.extname(filePath);
  if (extension === '.py') return 'python';
  if (extension === '.java') return 'java';
  return 'unknown';
}
