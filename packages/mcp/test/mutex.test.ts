import { describe, expect, it } from "vitest";

import { createMutex } from "../src/mutex";

describe("createMutex", () => {
  it("runs exclusive calls one at a time, in call order, regardless of duration", async () => {
    const mutex = createMutex();
    const order: number[] = [];
    const delaysMs = [30, 10, 20];

    const calls = delaysMs.map((delay, index) =>
      mutex(async () => {
        order.push(index * 2);
        await new Promise((resolve) => setTimeout(resolve, delay));
        order.push(index * 2 + 1);
        return index;
      }),
    );

    const results = await Promise.all(calls);
    expect(results).toEqual([0, 1, 2]);
    // Each call's end marker must appear before the next call's start marker.
    // Without serialization the 30ms first call would still be running when
    // the 10ms second call finishes, producing an out-of-order sequence.
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("keeps running subsequent calls after one call rejects", async () => {
    const mutex = createMutex();
    const first = mutex(async () => {
      throw new Error("boom");
    });
    const second = mutex(async () => "ok");

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });
});
