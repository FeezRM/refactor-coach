import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PackageInfo = {
  version: string;
};

export function readPackageInfo(
  packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
): PackageInfo {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    version?: unknown;
  };

  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error(`Package version is missing from ${packageJsonPath}.`);
  }

  return {
    version: packageJson.version,
  };
}

export function getPackageVersion(): string {
  return readPackageInfo().version;
}
