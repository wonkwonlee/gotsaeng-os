import type { ExtractedItem } from "./schemas/context";
import type { NoteDocument } from "./schemas/note";
import type { DateProvider, StaleDetectionOptions } from "./schemas/config";
import { isOlderThan } from "./utils/date";
import { compareStrings } from "./utils/path";

const DEFAULT_STALE_DAYS = 90;

export type StaleDetectionInput = {
  notes: NoteDocument[];
  items: ExtractedItem[];
} & StaleDetectionOptions;

export function detectStaleItems(input: StaleDetectionInput): ExtractedItem[] {
  const staleDays = input.staleDays ?? DEFAULT_STALE_DAYS;
  const dateProvider: DateProvider = input.dateProvider ?? (() => new Date());
  const now = dateProvider();
  const stale = new Map<string, ExtractedItem>();
  const staleNotePaths = new Set(
    input.notes
      .filter((note) => isOlderThan(note.updated, staleDays, now))
      .map((note) => note.path)
  );

  for (const item of input.items) {
    if (isOlderThan(item.updated, staleDays, now)) {
      stale.set(item.id, markStale(item));
      continue;
    }

    if (
      item.kind === "action" &&
      staleNotePaths.has(item.sourcePath) &&
      (item.status === "open" || item.status === "active")
    ) {
      stale.set(item.id, markStale(item));
    }
  }

  return [...stale.values()].sort((a, b) => {
    const source = compareStrings(a.sourcePath, b.sourcePath);
    if (source !== 0) {
      return source;
    }
    return compareStrings(a.text, b.text);
  });
}

export function markStale(item: ExtractedItem): ExtractedItem {
  return {
    ...item,
    status: "stale"
  };
}
