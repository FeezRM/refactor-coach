export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type Framework = 'next' | 'react' | 'react-native' | 'expo' | 'express' | 'unknown';

export type TestFramework = 'vitest' | 'jest' | 'playwright' | 'unknown';

export type CodeLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'unknown';

export type PriorityLevel = 'high' | 'medium' | 'low';

export type ResponsibilityTag =
  | 'ui'
  | 'state'
  | 'data-fetching'
  | 'business-logic'
  | 'routing'
  | 'validation'
  | 'database'
  | 'auth'
  | 'styling'
  | 'testing';

export type SignalSeverity = 'low' | 'medium' | 'high';

export type OpportunityType =
  | 'split-large-component'
  | 'extract-hook'
  | 'extract-service-layer'
  | 'deduplicate-logic'
  | 'simplify-complex-function'
  | 'improve-module-boundaries'
  | 'add-tests-before-refactor'
  | 'remove-dead-code';

export type CodeSignal = {
  type: string;
  message: string;
  severity: SignalSeverity;
  location?: {
    file: string;
    line?: number;
    column?: number;
  };
  metadata?: Record<string, unknown>;
};

export type ApiCallEvidence = {
  expression: string;
  kind: 'network-call' | 'client-call' | 'service-call' | 'data-hook';
  line?: number;
  receiver?: string;
  importSource?: string;
};

export type WorkspaceInfo = {
  name?: string;
  rootPath: string;
  packageManager?: PackageManager;
  framework?: Framework;
};

export type FunctionAnalysis = {
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  parameterCount: number;
  isAsync: boolean;
  hasTryCatch: boolean;
  tryCatchLineCount: number;
  conditionalCount: number;
  maxConditionalDepth: number;
  cyclomaticComplexity: number;
  hookCount: number;
  apiCallCount: number;
  apiCalls: ApiCallEvidence[];
  returnsJsx: boolean;
  bodyHash?: string;
};

export type FileAnalysis = {
  path: string;
  absolutePath: string;
  language: CodeLanguage;
  lineCount: number;
  importCount: number;
  exportCount: number;
  functionCount: number;
  componentCount: number;
  hookCount: number;
  hasTestsNearby: boolean;
  todoCount: number;
  complexityScore: number;
  responsibilities: ResponsibilityTag[];
  signals: CodeSignal[];
  functions: FunctionAnalysis[];
  importSources: string[];
  dependentCount: number;
  workspace?: WorkspaceInfo;
};

export type ProjectInfo = {
  rootPath: string;
  packageManager?: PackageManager;
  framework?: Framework;
  languages: string[];
  testFramework?: TestFramework;
  workspaces: WorkspaceInfo[];
};

export type RefactorOpportunity = {
  id: string;
  title: string;
  type: OpportunityType;
  files: string[];
  impact: number;
  risk: number;
  confidence: number;
  priority: number;
  priorityLabel: 'High' | 'Medium' | 'Low';
  explanation: string;
  suggestedSteps: string[];
  testsToAdd: string[];
  aiPromptPath?: string;
  signals: CodeSignal[];
  metadata?: Record<string, unknown>;
};

export type ScanSummary = {
  filesScanned: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  lowPriorityCount: number;
  highestRiskArea?: string;
  bestFirstRefactor?: string;
};

export type ScanResult = {
  project: ProjectInfo;
  files: FileAnalysis[];
  opportunities: RefactorOpportunity[];
  summary: ScanSummary;
};

export type ThresholdConfig = {
  largeFileLines: number;
  largeComponentLines: number;
  complexFunctionLines: number;
  maxFunctionParams: number;
  maxHooksInComponent: number;
  complexFunctionComplexity: number;
  maxResponsibilities: number;
};

export type AiConfig = {
  enabled: boolean;
  provider: 'openai' | 'anthropic' | 'ollama';
  model: string;
};

export type OutputConfig = {
  directory: string;
  format: Array<'markdown' | 'json'>;
  limit: number;
  minPriority: PriorityLevel;
};

export type AgentConfig = {
  allowDirty: boolean;
  maxFilesPerTask: number;
};

export type ChecksConfig = {
  commands: string[];
  autoDetect: boolean;
};

export type RefactorCoachConfig = {
  include: string[];
  exclude: string[];
  thresholds: ThresholdConfig;
  ai: AiConfig;
  output: OutputConfig;
  agent: AgentConfig;
  checks: ChecksConfig;
};
