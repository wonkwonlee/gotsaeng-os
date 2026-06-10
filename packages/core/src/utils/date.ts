const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toIsoTimestamp(date: Date): string {
  return date.toISOString();
}

export function parseDateLike(value: string): Date | undefined {
  const trimmed = value.trim();
  const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function normalizeDateValue(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = parseDateLike(value);
  if (!parsed) {
    return undefined;
  }

  return DATE_ONLY_PATTERN.test(value.trim()) ? value.trim() : parsed.toISOString();
}

export function isValidDateLike(value: unknown): boolean {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  if (typeof value !== "string") {
    return false;
  }

  return parseDateLike(value) !== undefined;
}

export function isOlderThan(dateValue: string | undefined, thresholdDays: number, now: Date): boolean {
  if (!dateValue) {
    return false;
  }

  const parsed = parseDateLike(dateValue);
  if (!parsed) {
    return false;
  }

  const ageMs = now.getTime() - parsed.getTime();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  return ageMs > thresholdMs;
}
