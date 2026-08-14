import { describe, expect, it } from "vitest";

import { describeValue } from "../src/utils/describe";

describe("describeValue", () => {
  it("passes strings through unquoted", () => {
    expect(describeValue("wiki")).toBe("wiki");
    expect(describeValue("")).toBe("");
  });

  it("renders scalars the way String() does", () => {
    expect(describeValue(42)).toBe("42");
    expect(describeValue(true)).toBe("true");
    expect(describeValue(null)).toBe("null");
    expect(describeValue(undefined)).toBe("undefined");
  });

  it("keeps the shape of maps and sequences visible", () => {
    expect(describeValue({ name: "wiki" })).toBe('{"name":"wiki"}');
    expect(describeValue(["a", "b"])).toBe('["a","b"]');
    expect(describeValue({ nested: { deep: [1] } })).toBe('{"nested":{"deep":[1]}}');
  });

  it("never falls back to the useless [object Object] rendering", () => {
    expect(describeValue({ a: 1 })).not.toContain("[object Object]");
  });

  it("renders dates as ISO strings, and invalid ones by name", () => {
    expect(describeValue(new Date("2026-06-06T00:00:00.000Z"))).toBe("2026-06-06T00:00:00.000Z");
    expect(describeValue(new Date("nope"))).toBe("Invalid Date");
  });

  it("survives values JSON cannot encode", () => {
    // YAML anchors can produce a cycle, which makes JSON.stringify throw.
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() => describeValue(cyclic)).not.toThrow();
    expect(describeValue(cyclic)).toBe("[object Object]");
  });
});
