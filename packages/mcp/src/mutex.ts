export type Mutex = <T>(fn: () => Promise<T>) => Promise<T>;

// A simple FIFO async mutex: every call chains onto a shared tail promise, so
// calls run one at a time in call order regardless of how long each one
// takes. A rejection from one call is swallowed for chaining purposes only —
// it still propagates to that call's own caller — so it never blocks
// subsequent calls.
export function createMutex(): Mutex {
  let tail: Promise<void> = Promise.resolve();

  return function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
