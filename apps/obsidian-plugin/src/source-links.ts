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
  /"sourcePath"\s*:\s*"([^"]+?\.md)"/giu,
];

const GENERATED_MARKDOWN_FILES = new Set(
  OUTPUT_ARTIFACTS.filter((artifact) => artifact.format === "markdown").map(
    (artifact) => artifact.fileName,
  ),
);

export type ReportBacklinkRef = {
  fileName: string;
  label: string;
  count: number;
};

export type NoteBacklinks = {
  path: string;
  label: string;
  totalCount: number;
  reports: ReportBacklinkRef[];
};

/**
 * Inverts extractSourceLinks across every generated Markdown report: for
 * each source note, which reports mention it and how many times. Reports are
 * looked up by artifact label/fileName rather than passed in, so callers
 * only need a fileName -> content map (e.g. every generated Markdown file).
 */
export function buildBacklinkIndex(
  filesByName: Partial<Record<string, string>>,
  options: ExtractSourceLinksOptions = {},
): NoteBacklinks[] {
  const byPath = new Map<string, NoteBacklinks>();

  for (const artifact of OUTPUT_ARTIFACTS) {
    if (artifact.format !== "markdown") {
      continue;
    }

    const content = filesByName[artifact.fileName];
    if (!content) {
      continue;
    }

    for (const link of extractSourceLinks(content, options)) {
      const ref: ReportBacklinkRef = {
        fileName: artifact.fileName,
        label: artifact.label,
        count: link.count,
      };
      const existing = byPath.get(link.path);
      if (existing) {
        existing.totalCount += link.count;
        existing.reports.push(ref);
      } else {
        byPath.set(link.path, {
          path: link.path,
          label: link.label,
          totalCount: link.count,
          reports: [ref],
        });
      }
    }
  }

  return [...byPath.values()]
    .map((entry) => ({
      ...entry,
      reports: entry.reports.sort(
        (left, right) => right.count - left.count || left.label.localeCompare(right.label),
      ),
    }))
    .sort(
      (left, right) =>
        right.totalCount - left.totalCount || compareStringsLocale(left.path, right.path),
    );
}

export function extractSourceLinks(
  content: string,
  options: ExtractSourceLinksOptions = {},
): SourceLink[] {
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
    .sort((left, right) => right.count - left.count || compareStringsLocale(left.path, right.path))
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

// Deliberately NOT core's compareStrings, which orders by raw code point. Source
// links are shown to the user, so they sort case- and accent-insensitively. The
// name is distinct to keep the two orderings from being mistaken for each other.
function compareStringsLocale(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}
