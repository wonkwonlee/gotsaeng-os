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

// `decodeReserved` marks the patterns whose match came out of a wikilink
// target, which is the only place `toVaultWikiLink` (reports.ts)
// percent-encodes the characters Obsidian reserves there. The other two
// patterns read paths written verbatim, so decoding them would corrupt a path
// that legitimately contains a "%5B"-shaped substring.
const SOURCE_PATTERNS: { pattern: RegExp; decodeReserved: boolean }[] = [
  { pattern: /\[\[([^[\]|#]+?\.md)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/giu, decodeReserved: true },
  { pattern: /\bsource:\s*([^;)\n]+?\.md)\b/giu, decodeReserved: false },
  { pattern: /"sourcePath"\s*:\s*"([^"]+?\.md)"/giu, decodeReserved: false },
];

// The inverse of toVaultWikiLink's encoding, limited to exactly the six
// characters it encodes. A blanket decodeURIComponent would instead throw on a
// stray "%" and rewrite unrelated escapes in a path that never went through
// that encoder. "%25" (an encoded `%`) is part of the set for the same reason
// the encoder escapes `%` at all: it is what keeps a path containing a literal
// "%5B" from being decoded into one containing "[". A single pass is enough
// and is what makes the two-level case ("%255B") come out right — the `%` this
// restores is not re-scanned, so the "5B" behind it stays literal.
const ENCODED_WIKILINK_RESERVED = /%(25|5B|5D|7C|23|5E)/giu;

// Known, accepted limitation: this runs on every wikilink target in a
// generated report, including one a user hand-wrote into a report file that
// never passed through `toVaultWikiLink`. A hand-written `[[Notes/100%25
// off.md]]` naming a file literally called "100%25 off.md" is decoded to
// "100% off.md" and resolves to nothing. The extractor cannot tell its own
// encoder's output apart from user-authored text using the same syntax — both
// are just characters in a wikilink — so distinguishing them would need a
// marker in the emitted link, which would be visible in the report and would
// itself have to be escaped. The exposure is bounded by this function's own
// pattern, not by the encoder: ENCODED_WIKILINK_RESERVED only matches one of
// these six sequences, so a hand-written link has to contain one of them to
// be affected at all — true before and after WIKILINK_RESERVED (reports.ts)
// was narrowed to escape `%` only ahead of these same six codes, since that
// change controls what the encoder emits, not what this decoder looks for.
function decodeWikiLinkReserved(value: string): string {
  return value.replace(ENCODED_WIKILINK_RESERVED, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

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

  for (const { pattern, decodeReserved } of SOURCE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const path = normalizeSourcePath(match[1] ?? "", decodeReserved);
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

function normalizeSourcePath(rawPath: string, decodeReserved: boolean): string | null {
  const decoded = decodeReserved ? decodeWikiLinkReserved(rawPath) : rawPath;
  const normalized = decoded
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
