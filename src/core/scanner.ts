import path from 'node:path';
import { Project } from 'ts-morph';
import type { FileAnalysis, RefactorCoachConfig, ScanResult, WorkspaceInfo } from './types.js';
import { analyzeFile } from '../analyzers/fileMetricsAnalyzer.js';
import { analyzeHeuristicLanguageFile } from '../analyzers/heuristicLanguageAnalyzer.js';
import { detectOpportunities } from '../opportunities/opportunityDetector.js';
import { collectSourceFiles } from './fileCollector.js';
import { detectProject } from './projectDetector.js';

export async function scanRepository(
  rootPath: string,
  config: RefactorCoachConfig,
): Promise<ScanResult> {
  const files = await collectSourceFiles(rootPath, config);
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: 4,
      skipLibCheck: true,
    },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
  });

  const projectInfo = detectProject(rootPath, files);
  const analyses = files.map((file) =>
    isTypeScriptOrJavaScript(file)
      ? analyzeFile(project, rootPath, file, files, config)
      : analyzeHeuristicLanguageFile(rootPath, file, files, config),
  );
  assignWorkspaceMetadata(analyses, projectInfo.workspaces);
  populateDependentCounts(rootPath, analyses);

  const opportunities = detectOpportunities(analyses, config);
  const summary = {
    filesScanned: analyses.length,
    highPriorityCount: opportunities.filter((opportunity) => opportunity.priorityLabel === 'High')
      .length,
    mediumPriorityCount: opportunities.filter(
      (opportunity) => opportunity.priorityLabel === 'Medium',
    ).length,
    lowPriorityCount: opportunities.filter((opportunity) => opportunity.priorityLabel === 'Low')
      .length,
    highestRiskArea: opportunities.slice().sort((a, b) => b.risk - a.risk)[0]?.files[0],
    bestFirstRefactor: opportunities[0]?.files[0],
  };

  return {
    project: projectInfo,
    files: analyses,
    opportunities,
    summary,
  };
}

function isTypeScriptOrJavaScript(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

function assignWorkspaceMetadata(analyses: FileAnalysis[], workspaces: WorkspaceInfo[]): void {
  const sortedWorkspaces = workspaces.slice().sort((a, b) => b.rootPath.length - a.rootPath.length);

  for (const analysis of analyses) {
    const workspace = sortedWorkspaces.find(
      (candidate) =>
        analysis.path === candidate.rootPath || analysis.path.startsWith(`${candidate.rootPath}/`),
    );

    if (workspace) {
      analysis.workspace = workspace;
    }
  }
}

function populateDependentCounts(rootPath: string, analyses: FileAnalysis[]): void {
  const byAbsolutePath = new Map(analyses.map((analysis) => [analysis.absolutePath, analysis]));
  const resolvedDependents = new Map<string, number>();

  for (const analysis of analyses) {
    const importerAbsolutePath = path.join(rootPath, analysis.path);
    const importerDirectory = path.dirname(importerAbsolutePath);

    for (const importSource of analysis.importSources) {
      if (!importSource.startsWith('.')) continue;
      const resolved = resolveImport(importerDirectory, importSource, byAbsolutePath);
      if (!resolved) continue;
      resolvedDependents.set(resolved, (resolvedDependents.get(resolved) ?? 0) + 1);
    }
  }

  for (const analysis of analyses) {
    analysis.dependentCount = resolvedDependents.get(analysis.absolutePath) ?? 0;
  }
}

function resolveImport(
  importerDirectory: string,
  importSource: string,
  byAbsolutePath: Map<string, FileAnalysis>,
): string | undefined {
  const base = path.resolve(importerDirectory, importSource);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
  ];

  return candidates.find((candidate) => byAbsolutePath.has(candidate));
}
