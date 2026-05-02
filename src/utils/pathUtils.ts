import path from 'node:path';

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function relativeToRoot(rootPath: string, filePath: string): string {
  return toPosixPath(path.relative(rootPath, filePath));
}

export function withoutExtension(filePath: string): string {
  return filePath.replace(/\.[^.]+$/, '');
}

export function isTestFile(filePath: string): boolean {
  return (
    /(^|[/\\])(__tests__|tests?)([/\\])/.test(filePath) ||
    /\.(test|spec)\.[jt]sx?$/.test(filePath) ||
    /(^|[/\\])test_[^/\\]+\.py$/.test(filePath) ||
    /Test\.java$/.test(filePath)
  );
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function ensureMarkdownFileName(index: number, title: string): string {
  return `${String(index).padStart(2, '0')}_${slugify(title)}.md`;
}
