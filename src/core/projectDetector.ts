import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import type {
  Framework,
  PackageManager,
  ProjectInfo,
  TestFramework,
  WorkspaceInfo,
} from './types.js';

type PackageJson = Record<string, unknown> & {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

export function detectProject(rootPath: string, files: string[]): ProjectInfo {
  const packageJsonPath = path.join(rootPath, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? safeReadPackageJson(packageJsonPath)
    : { dependencies: {}, devDependencies: {} };
  const packageManager = detectPackageManager(rootPath);
  const workspaces = detectWorkspaces(rootPath, packageJson, packageManager);

  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
    ...Object.fromEntries(
      workspaces.flatMap((workspace) => {
        const workspacePackageJson = safeReadPackageJson(
          path.join(rootPath, workspace.rootPath, 'package.json'),
        );
        return Object.entries({
          ...(workspacePackageJson.dependencies ?? {}),
          ...(workspacePackageJson.devDependencies ?? {}),
        });
      }),
    ),
  } as Record<string, string>;

  return {
    rootPath,
    packageManager,
    framework: detectFramework(dependencies, rootPath),
    languages: detectLanguages(files),
    testFramework: detectTestFramework(dependencies),
    workspaces,
  };
}

function safeReadPackageJson(filePath: string): PackageJson {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as PackageJson;
  } catch {
    return { dependencies: {}, devDependencies: {} };
  }
}

function detectPackageManager(rootPath: string): PackageManager | undefined {
  if (existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(rootPath, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(rootPath, 'bun.lockb')) || existsSync(path.join(rootPath, 'bun.lock'))) {
    return 'bun';
  }
  if (existsSync(path.join(rootPath, 'package-lock.json'))) return 'npm';
  return undefined;
}

function detectFramework(dependencies: Record<string, string>, packageRoot: string): Framework {
  if (
    'expo' in dependencies ||
    'expo-router' in dependencies ||
    existsSync(path.join(packageRoot, 'app.json'))
  ) {
    return 'expo';
  }
  if ('react-native' in dependencies) return 'react-native';
  if ('next' in dependencies) return 'next';
  if ('react' in dependencies || 'react-dom' in dependencies) return 'react';
  if ('express' in dependencies) return 'express';
  return 'unknown';
}

function detectTestFramework(dependencies: Record<string, string>): TestFramework {
  if ('vitest' in dependencies) return 'vitest';
  if ('jest' in dependencies) return 'jest';
  if ('@playwright/test' in dependencies || 'playwright' in dependencies) return 'playwright';
  return 'unknown';
}

function detectLanguages(files: string[]): string[] {
  const extensions = new Set<string>();

  for (const file of files) {
    const extension = path.extname(file);
    if (extension === '.ts' || extension === '.tsx') extensions.add('typescript');
    if (extension === '.js' || extension === '.jsx') extensions.add('javascript');
    if (extension === '.py') extensions.add('python');
    if (extension === '.java') extensions.add('java');
  }

  return Array.from(extensions).sort();
}

function detectWorkspaces(
  rootPath: string,
  rootPackageJson: PackageJson,
  packageManager: PackageManager | undefined,
): WorkspaceInfo[] {
  const workspacePatterns = normalizeWorkspacePatterns(rootPackageJson.workspaces);
  if (workspacePatterns.length === 0) {
    return [];
  }

  return fg
    .sync(
      workspacePatterns.map((pattern) => `${pattern.replace(/\/$/, '')}/package.json`),
      {
        cwd: rootPath,
        onlyFiles: true,
        dot: false,
        ignore: ['node_modules/**', '.git/**'],
      },
    )
    .map((packageJsonRelativePath) => {
      const workspaceRoot = path.dirname(packageJsonRelativePath).replace(/\\/g, '/');
      const workspacePackageJson = safeReadPackageJson(
        path.join(rootPath, packageJsonRelativePath),
      );
      const dependencies = {
        ...(workspacePackageJson.dependencies ?? {}),
        ...(workspacePackageJson.devDependencies ?? {}),
      };
      return {
        name: workspacePackageJson.name,
        rootPath: workspaceRoot,
        packageManager,
        framework: detectFramework(dependencies, path.join(rootPath, workspaceRoot)),
      };
    })
    .sort((a, b) => a.rootPath.localeCompare(b.rootPath));
}

function normalizeWorkspacePatterns(workspaces: PackageJson['workspaces']): string[] {
  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  if (workspaces && Array.isArray(workspaces.packages)) {
    return workspaces.packages;
  }

  return [];
}
