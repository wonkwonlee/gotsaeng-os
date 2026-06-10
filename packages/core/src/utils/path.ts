import path from "node:path";

export function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function toRelativeSourcePath(rootPath: string, filePath: string): string {
  return normalizePath(path.relative(rootPath, filePath));
}

export function titleFromFilename(filePath: string): string {
  const parsed = path.parse(filePath);
  return parsed.name
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
