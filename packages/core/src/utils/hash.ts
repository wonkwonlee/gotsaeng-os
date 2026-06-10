import { createHash } from "node:crypto";

export function normalizeTextForId(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function createDeterministicId(parts: string[]): string {
  const normalized = parts.map((part) => normalizeTextForId(part)).join("|");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
