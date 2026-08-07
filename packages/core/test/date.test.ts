import { describe, expect, it } from "vitest";

import { isOlderThan, isValidDateLike, normalizeDateValue, parseDateLike } from "../src/utils/date";

describe("parseDateLike", () => {
  it("accepts real calendar dates", () => {
    expect(parseDateLike("2026-06-15")?.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    // Date.UTC would roll these over (2024-13-40 -> 2025-02-09) without this guard.
    expect(parseDateLike("2024-13-40")).toBeUndefined();
    expect(parseDateLike("2024-02-30")).toBeUndefined();
    expect(parseDateLike("2024-00-10")).toBeUndefined();
    expect(isValidDateLike("2024-02-30")).toBe(false);
  });

  it("accepts strict ISO-8601 date-times with an explicit zone", () => {
    expect(parseDateLike("2026-06-15T08:30:00Z")?.toISOString()).toBe("2026-06-15T08:30:00.000Z");
    expect(parseDateLike("2026-06-15T08:30:00+09:00")?.toISOString()).toBe(
      "2026-06-14T23:30:00.000Z",
    );
  });

  it("rejects locale-dependent and partial date strings", () => {
    // The lenient `new Date(string)` constructor used to accept all of these
    // with locale/timezone-dependent or silently-widened results.
    expect(parseDateLike("June 15 2026")).toBeUndefined();
    expect(parseDateLike("2024")).toBeUndefined();
    expect(parseDateLike("2024-06")).toBeUndefined();
    expect(parseDateLike("now")).toBeUndefined();
    // Zone-less date-times are non-deterministic across machines, so reject them.
    expect(parseDateLike("2026-06-15T08:30:00")).toBeUndefined();
  });
});

describe("normalizeDateValue", () => {
  it("returns undefined for impossible and locale dates", () => {
    expect(normalizeDateValue("2024-02-30")).toBeUndefined();
    expect(normalizeDateValue("June 15 2026")).toBeUndefined();
  });

  it("preserves a valid date-only string verbatim", () => {
    expect(normalizeDateValue("2026-06-15")).toBe("2026-06-15");
  });
});

describe("isValidDateLike", () => {
  it("accepts a valid Date instance", () => {
    expect(isValidDateLike(new Date("2026-06-15T00:00:00.000Z"))).toBe(true);
  });

  it("rejects an invalid Date instance", () => {
    expect(isValidDateLike(new Date("not a date"))).toBe(false);
  });

  it("rejects non-string, non-Date values without attempting to parse them", () => {
    expect(isValidDateLike(12345)).toBe(false);
    expect(isValidDateLike(null)).toBe(false);
    expect(isValidDateLike(undefined)).toBe(false);
    expect(isValidDateLike({})).toBe(false);
  });

  it("accepts a valid date string", () => {
    expect(isValidDateLike("2026-06-15")).toBe(true);
  });
});

describe("isOlderThan", () => {
  const now = new Date("2026-06-06T00:00:00.000Z");

  it("returns false when dateValue is undefined", () => {
    expect(isOlderThan(undefined, 90, now)).toBe(false);
  });

  it("returns false when dateValue cannot be parsed", () => {
    expect(isOlderThan("not a date", 90, now)).toBe(false);
  });

  it("returns true once the age exceeds the threshold in days", () => {
    expect(isOlderThan("2026-01-01", 90, now)).toBe(true);
  });

  it("returns false when the age is within the threshold", () => {
    expect(isOlderThan("2026-06-01", 90, now)).toBe(false);
  });
});
