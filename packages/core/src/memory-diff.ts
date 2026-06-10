import fs from "node:fs/promises";
import path from "node:path";

import {
  ContextManifestSchema,
  MemoryDiffSchema,
  type ContextManifest,
  type ContextManifestItem,
  type ContextPack,
  type ExtractedItem,
  type MemoryDiff,
  type MemoryDiffChangedField,
  type MemoryDiffResolvedItem
} from "./schemas/context";
import { compareStrings } from "./utils/path";

export const CONTEXT_MANIFEST_FILE = "CONTEXT_MANIFEST.json";
export const MEMORY_DIFF_FILE = "MEMORY_DIFF.md";

export type PreviousManifestReadResult = {
  manifest: ContextManifest | null;
  warning?: string;
};

export function createContextManifest(pack: ContextPack): ContextManifest {
  const staleIds = new Set(pack.staleItems.map((item) => item.id));
  const items = getAllItems(pack)
    .map((item): ContextManifestItem => ({
      ...item,
      stale: staleIds.has(item.id) || item.status === "stale"
    }))
    .sort(compareManifestItems);

  return ContextManifestSchema.parse({
    projectName: pack.projectName,
    generatedAt: pack.generatedAt,
    sourceRoot: pack.sourceRoot,
    itemCount: items.length,
    items
  });
}

export function diffContextManifests(
  previousManifest: ContextManifest | null,
  currentManifest: ContextManifest,
  generatedAt = currentManifest.generatedAt
): MemoryDiff {
  if (!previousManifest) {
    return MemoryDiffSchema.parse({
      projectName: currentManifest.projectName,
      generatedAt,
      currentGeneratedAt: currentManifest.generatedAt,
      previousManifestFound: false,
      summary: {
        newlyAdded: 0,
        changed: 0,
        newlyStale: 0,
        resolved: 0
      },
      newlyAdded: [],
      changed: [],
      newlyStale: [],
      resolved: []
    });
  }

  const previousById = new Map(previousManifest.items.map((item) => [item.id, item]));
  const currentById = new Map(currentManifest.items.map((item) => [item.id, item]));
  const newlyAdded = currentManifest.items.filter((item) => !previousById.has(item.id)).sort(compareManifestItems);
  const changed = currentManifest.items
    .flatMap((current) => {
      const previous = previousById.get(current.id);
      if (!previous) {
        return [];
      }
      const changes = getChangedFields(previous, current);
      return changes.length > 0 ? [{ previous, current, changes }] : [];
    })
    .sort((a, b) => compareManifestItems(a.current, b.current));
  const newlyStale = currentManifest.items
    .filter((current) => current.stale && !previousById.get(current.id)?.stale)
    .sort(compareManifestItems);
  const resolved = previousManifest.items
    .flatMap((previous): MemoryDiffResolvedItem[] => {
      const current = currentById.get(previous.id);
      if (current?.status === "done" && previous.status !== "done") {
        return [{ item: current, reason: "now_done" }];
      }
      if (current && previous.stale && !current.stale) {
        return [{ item: current, reason: "no_longer_stale" }];
      }
      if (!current && isResolvable(previous)) {
        return [{ item: previous, reason: "removed_or_rewritten" }];
      }
      return [];
    })
    .sort((a, b) => compareManifestItems(a.item, b.item));

  return MemoryDiffSchema.parse({
    projectName: currentManifest.projectName,
    generatedAt,
    previousGeneratedAt: previousManifest.generatedAt,
    currentGeneratedAt: currentManifest.generatedAt,
    previousManifestFound: true,
    summary: {
      newlyAdded: newlyAdded.length,
      changed: changed.length,
      newlyStale: newlyStale.length,
      resolved: resolved.length
    },
    newlyAdded,
    changed,
    newlyStale,
    resolved
  });
}

export function renderContextManifest(manifest: ContextManifest): string {
  return `${JSON.stringify(ContextManifestSchema.parse(manifest), null, 2)}\n`;
}

export function renderMemoryDiff(diff: MemoryDiff): string {
  const lines = [
    `# Memory Diff: ${diff.projectName}`,
    "",
    `Generated: ${diff.generatedAt}`,
    `Previous compile: ${diff.previousGeneratedAt ?? "none"}`,
    `Current compile: ${diff.currentGeneratedAt}`,
    "",
    "## Summary",
    "",
    `- Previous manifest found: ${diff.previousManifestFound ? "yes" : "no"}`,
    `- Newly added: ${diff.summary.newlyAdded}`,
    `- Changed: ${diff.summary.changed}`,
    `- Newly stale: ${diff.summary.newlyStale}`,
    `- Resolved: ${diff.summary.resolved}`,
    ""
  ];

  if (!diff.previousManifestFound) {
    lines.push(
      "No previous `CONTEXT_MANIFEST.json` was found. This compile establishes the local memory diff baseline.",
      ""
    );
  }

  lines.push("## Newly Added", "", renderManifestItemGroups(diff.newlyAdded), "");
  lines.push("## Changed", "", renderChangedItemGroups(diff.changed), "");
  lines.push("## Newly Stale", "", renderManifestItemGroups(diff.newlyStale), "");
  lines.push("## Resolved", "", renderResolvedItemGroups(diff.resolved), "");
  lines.push("## Notes", "");
  lines.push("- Text edits change deterministic item IDs, so rewritten items may appear as newly added plus resolved.");
  lines.push("- Diffing is local-only and compares the previous output manifest against the current compile.");
  lines.push("");

  return lines.join("\n");
}

export async function readPreviousContextManifest(outputDir: string): Promise<PreviousManifestReadResult> {
  const filePath = path.join(outputDir, CONTEXT_MANIFEST_FILE);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return {
      manifest: ContextManifestSchema.parse(JSON.parse(raw))
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { manifest: null };
    }

    return {
      manifest: null,
      warning: `Previous context manifest could not be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function writeContextManifest(manifest: ContextManifest, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, CONTEXT_MANIFEST_FILE), renderContextManifest(manifest), "utf8");
}

export async function writeMemoryDiff(diff: MemoryDiff, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, MEMORY_DIFF_FILE), renderMemoryDiff(diff), "utf8");
}

function getAllItems(pack: ContextPack): ExtractedItem[] {
  return [
    ...pack.facts,
    ...pack.decisions,
    ...pack.actions,
    ...pack.risks,
    ...pack.assumptions,
    ...pack.questions,
    ...pack.insights
  ];
}

function getChangedFields(previous: ContextManifestItem, current: ContextManifestItem): MemoryDiffChangedField[] {
  const changes: MemoryDiffChangedField[] = [];
  addFieldChange(changes, "sourceTitle", previous.sourceTitle, current.sourceTitle);
  addFieldChange(changes, "status", previous.status ?? "", current.status ?? "");
  addFieldChange(changes, "priority", previous.priority ?? "", current.priority ?? "");
  addFieldChange(changes, "created", previous.created ?? "", current.created ?? "");
  addFieldChange(changes, "updated", previous.updated ?? "", current.updated ?? "");
  addFieldChange(changes, "tags", previous.tags.join(","), current.tags.join(","));
  addFieldChange(changes, "stale", String(previous.stale), String(current.stale));
  addFieldChange(changes, "provenanceScore", String(previous.provenance?.score ?? ""), String(current.provenance?.score ?? ""));
  addFieldChange(changes, "provenanceLevel", previous.provenance?.level ?? "", current.provenance?.level ?? "");
  addFieldChange(changes, "confidenceScore", String(previous.confidence?.score ?? ""), String(current.confidence?.score ?? ""));
  addFieldChange(changes, "confidenceLevel", previous.confidence?.level ?? "", current.confidence?.level ?? "");
  return changes;
}

function addFieldChange(
  changes: MemoryDiffChangedField[],
  field: string,
  previous: string,
  current: string
): void {
  if (previous !== current) {
    changes.push({ field, previous, current });
  }
}

function isResolvable(item: ContextManifestItem): boolean {
  return (
    item.kind === "action" ||
    item.kind === "question" ||
    item.kind === "risk" ||
    item.stale ||
    item.status === "open" ||
    item.status === "active" ||
    item.status === "stale"
  );
}

function compareManifestItems(a: ContextManifestItem, b: ContextManifestItem): number {
  return (
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.sourcePath, b.sourcePath) ||
    compareStrings(a.text, b.text) ||
    compareStrings(a.id, b.id)
  );
}

function renderManifestItemList(items: ContextManifestItem[]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return items.map((item) => `- ${renderManifestItem(item)}`).join("\n");
}

function renderManifestItemGroups(items: ContextManifestItem[]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return groupBySource(items)
    .map((group) => [`### ${group.sourcePath}`, "", renderManifestItemList(group.items)].join("\n"))
    .join("\n\n");
}

function renderChangedItems(items: MemoryDiff["changed"]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return items
    .map(({ current, changes }) => `- ${renderManifestItem(current)}; changes: ${renderChanges(changes)}`)
    .join("\n");
}

function renderChangedItemGroups(items: MemoryDiff["changed"]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return groupBySource(items, (item) => item.current)
    .map((group) => [`### ${group.sourcePath}`, "", renderChangedItems(group.items)].join("\n"))
    .join("\n\n");
}

function renderResolvedItems(items: MemoryDiff["resolved"]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return items.map(({ item, reason }) => `- ${renderManifestItem(item)}; reason: ${renderResolutionReason(reason)}`).join("\n");
}

function renderResolvedItemGroups(items: MemoryDiff["resolved"]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return groupBySource(items, (item) => item.item)
    .map((group) => [`### ${group.sourcePath}`, "", renderResolvedItems(group.items)].join("\n"))
    .join("\n\n");
}

function renderManifestItem(item: ContextManifestItem): string {
  const details = [
    `source: ${item.sourcePath}`,
    `kind: ${item.kind}`,
    `status: ${item.status ?? "unknown"}`,
    item.priority ? `priority: ${item.priority}` : undefined,
    item.updated ? `updated: ${item.updated}` : undefined,
    item.stale ? "stale: yes" : undefined,
    item.provenance ? `provenance: ${item.provenance.level} ${item.provenance.score}` : undefined,
    item.confidence ? `confidence: ${item.confidence.level} ${item.confidence.score}` : undefined
  ].filter((value): value is string => Boolean(value));

  return `${item.text} (${details.join("; ")})`;
}

function renderChanges(changes: MemoryDiffChangedField[]): string {
  return changes.map((change) => `${change.field} ${renderValue(change.previous)} -> ${renderValue(change.current)}`).join(", ");
}

function renderValue(value: string): string {
  return value.length > 0 ? value : "unset";
}

function renderResolutionReason(reason: MemoryDiffResolvedItem["reason"]): string {
  if (reason === "now_done") {
    return "now done";
  }
  if (reason === "no_longer_stale") {
    return "no longer stale";
  }
  return "removed or rewritten";
}

function groupBySource<T>(
  items: T[],
  getItem: (item: T) => ContextManifestItem = (item) => item as ContextManifestItem
): Array<{ sourcePath: string; items: T[] }> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const sourcePath = getItem(item).sourcePath;
    groups.set(sourcePath, [...(groups.get(sourcePath) ?? []), item]);
  }

  return [...groups.entries()]
    .map(([sourcePath, groupedItems]) => ({ sourcePath, items: groupedItems }))
    .sort((left, right) => right.items.length - left.items.length || compareStrings(left.sourcePath, right.sourcePath));
}
