import { compareStrings } from "./path";

/**
 * Orders a count map by key so report output is deterministic across runs.
 * Every `*Stats` builder shares this, which is what keeps their key ordering
 * identical in the generated Markdown and JSON.
 */
export function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => compareStrings(left, right)),
  );
}
