import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ScanResult } from '../core/types.js';

export function writeJsonReport(outputDirectory: string, scanResult: ScanResult): string {
  const dataDirectory = path.join(outputDirectory, 'data');
  mkdirSync(dataDirectory, { recursive: true });

  const outputPath = path.join(dataDirectory, 'scan.json');
  writeFileSync(outputPath, `${JSON.stringify(scanResult, null, 2)}\n`, 'utf8');
  return outputPath;
}
