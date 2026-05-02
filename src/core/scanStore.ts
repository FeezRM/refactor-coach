import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { RefactorOpportunity, ScanResult } from './types.js';

export function getOutputDirectory(rootPath: string, outputDirectory: string): string {
  return path.resolve(rootPath, outputDirectory);
}

export function readLatestScan(outputDirectory: string): ScanResult {
  const scanPath = path.join(outputDirectory, 'data', 'scan.json');
  if (!existsSync(scanPath)) {
    throw new Error('No scan data found. Run `refactor-coach scan` first.');
  }

  return JSON.parse(readFileSync(scanPath, 'utf8')) as ScanResult;
}

export function findOpportunity(
  scanResult: ScanResult,
  opportunityId: string,
): RefactorOpportunity {
  const opportunity =
    scanResult.opportunities.find((candidate) => candidate.id === opportunityId) ??
    scanResult.opportunities[Number(opportunityId) - 1];

  if (!opportunity) {
    throw new Error(`No opportunity found for id ${opportunityId}.`);
  }

  return opportunity;
}
