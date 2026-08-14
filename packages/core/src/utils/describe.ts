/**
 * Renders an arbitrary frontmatter value for inclusion in a validation message.
 *
 * Frontmatter is user-authored YAML, so any field can hold a map or a sequence
 * where a scalar was expected. Plain `String(value)` collapses those to
 * "[object Object]", which tells the reader nothing about what they actually
 * wrote — this keeps the offending shape visible instead.
 */
export function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || typeof value !== "object") {
    return String(value);
  }

  // JSON.stringify encodes an invalid Date as `null`, which loses the one
  // useful thing left to say about it. (Frontmatter dates are normalized to
  // strings before validation reads them, so this is a guard for other callers
  // rather than a path the parser reaches.)
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  }

  try {
    // JSON.stringify returns undefined for values it cannot represent, and
    // throws on cycles (which YAML anchors can produce).
    return JSON.stringify(value) ?? Object.prototype.toString.call(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
