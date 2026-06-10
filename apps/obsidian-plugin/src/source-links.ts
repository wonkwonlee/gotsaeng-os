import { OUTPUT_ARTIFACTS } from "./artifacts";

export type SourceLink = {
  path: string;
  label: string;
  count: number;
};

export type ExtractSourceLinksOptions = {
  outputFolder?: string;
  limit?: number;
};

const DEFAULT_LINK_LIMIT = 24;

const SOURCE_PATTERNS = [
  /\[\[([^[\]|#]+?\.md)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/giu,
  /\bsource:\s*([^;)\n]+?\.md)\b/giu,
  /"sourcePath"\s*:\s*"([^"]+?\.md)"/giu
];

const GENERATED_MARKDOWN_FILES = new Set(
  OUTPUT_ARTIFACTS.filter((artifact) => artifact.format === "markdown").map((artifact) => artifact.fileName)
);

export function extractSourceLinks(content: string, options: ExtractSourceLinksOptions = {}): SourceLink[] {
  const linksByPath = new Map<string, SourceLink>();
  const limit = options.limit ?? DEFAULT_LINK_LIMIT;

  for (const pattern of SOURCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const path = normalizeSourcePath(match[1] ?? "");
      if (!path || isGeneratedOutputPath(path, options.outputFolder)) {
        continue;
      }

      const label = normalizeSourceLabel(match[2], path);
      const existing = linksByPath.get(path);
      if (existing) {
        existing.count += 1;
      } else {
        linksByPath.set(path, { path, label, count: 1 });
      }
    }
  }

  return [...linksByPath.values()]
    .sort((left, right) => right.count - left.count || compareStrings(left.path, right.path))
    .slice(0, limit);
}

function normalizeSourcePath(rawPath: string): string | null {
  const normalized = rawPath
    .trim()
    .replace(/^["'<]+|[>"']+$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  if (!normalized.endsWith(".md") || normalized.length === 0) {
    return null;
  }

  if (/^(https?:|obsidian:|file:)/iu.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeSourceLabel(rawLabel: string | undefined, sourcePath: string): string {
  const label = rawLabel?.trim().replace(/\s+/g, " ");
  return label && label.length > 0 ? label : sourcePath;
}

function isGeneratedOutputPath(sourcePath: string, outputFolder: string | undefined): boolean {
  const normalizedOutputFolder = outputFolder?.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  if (normalizedOutputFolder && sourcePath.startsWith(`${normalizedOutputFolder}/`)) {
    return true;
  }

  return GENERATED_MARKDOWN_FILES.has(sourcePath);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}
