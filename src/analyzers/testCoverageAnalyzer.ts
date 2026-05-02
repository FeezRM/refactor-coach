import { existsSync } from 'node:fs';
import path from 'node:path';
import { isTestFile } from '../utils/pathUtils.js';

const TEST_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'py', 'java'];

export function hasNearbyTest(filePath: string, allFiles: string[]): boolean {
  if (isTestFile(filePath)) {
    return true;
  }

  const allFileSet = new Set(allFiles.map((file) => path.normalize(file)));
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const basename = path.basename(filePath, extension);

  const candidates = TEST_EXTENSIONS.flatMap((testExtension) => [
    path.join(directory, `${basename}.test.${testExtension}`),
    path.join(directory, `${basename}.spec.${testExtension}`),
    path.join(directory, '__tests__', `${basename}.test.${testExtension}`),
    path.join(directory, '__tests__', `${basename}.spec.${testExtension}`),
    path.join(directory, `test_${basename}.${testExtension}`),
    path.join(directory, `${basename}Test.${testExtension}`),
  ]);

  return candidates.some(
    (candidate) => allFileSet.has(path.normalize(candidate)) || existsSync(candidate),
  );
}
