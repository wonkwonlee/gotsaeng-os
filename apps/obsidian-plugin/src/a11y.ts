// Accessibility helpers shared by the two surfaces this plugin renders
// imperatively: the Report Hub view (view.ts) and the settings tab
// (GotSaengSettingTab in main.ts). Both rebuild their entire subtree on every
// render, which is what makes these two problems shared rather than local —
// an error injected during a wholesale rebuild is never announced, and
// whatever the user had focused is dropped on the floor.

/** Attribute carrying the stable identity {@link FocusRestorer} restores by. */
export const FOCUS_KEY_ATTRIBUTE = "data-focus-key";

export type LiveRegionPoliteness = "polite" | "assertive";

// A live region only announces content that changes *after* the region itself
// is in the accessibility tree: a div that is created and filled in the same
// render (which is what a plain error banner injected during a rebuild is)
// announces nothing at all. So a region has to outlive the content around it —
// created empty once, then written into later. Callers that rebuild their whole
// subtree must keep the region out of the part they tear down (see
// ReportHubShell in view.ts); creating a fresh empty region on every render is
// not enough, because the region a message lands in is then always one that
// appeared in the same pass. Its empty state must also stay rendered — zero
// size, or clipped to 1px for a region that is never meant to be seen, but
// never `display: none`/`visibility: hidden` (see styles.css) — or it is not in
// the accessibility tree to begin with.
export function createLiveRegion(
  parent: HTMLElement,
  cls: string,
  politeness: LiveRegionPoliteness,
): HTMLElement {
  return parent.createDiv({
    cls,
    attr: {
      role: politeness === "assertive" ? "alert" : "status",
      "aria-live": politeness,
      "aria-atomic": "true",
    },
  });
}

/**
 * Restores keyboard focus across a wholesale DOM rebuild.
 *
 * Elements are tagged with a stable key (an action label, an artifact file
 * name, a setting key) as they are built. `capture()` records which key had
 * focus just before the teardown; `register()` re-focuses the equivalent
 * element in the rebuilt tree. `request()` asks for focus to land somewhere
 * specific after a rebuild the user triggered from elsewhere (e.g. picking
 * "Custom path" should focus the path field, not the dropdown).
 */
export class FocusRestorer {
  private pendingKey: string | null = null;
  // Set by request(), consumed by the very next capture(). An explicit request
  // is made *because* focus is about to move somewhere other than where it is
  // now — picking "Custom path" in the visibility dropdown asks for the path
  // field while the dropdown itself is still focused. Skipping only the
  // "nothing focus-keyed is focused" case was not enough: the dropdown carries
  // a key of its own, so capture() overwrote the request unconditionally and
  // the path field never got focus (the regression issue #25 fixed). The flag
  // is one-shot rather than sticky so a request whose target never materializes
  // cannot wedge capture() off permanently.
  private requestOutranksNextCapture = false;

  /** Records the focused element's key, if it has one, before a rebuild. */
  capture(): void {
    if (this.requestOutranksNextCapture) {
      this.requestOutranksNextCapture = false;
      return;
    }

    const key = activeFocusKey();
    // Only overwrite when something focus-keyed is actually focused, so an
    // explicit request() made moments earlier survives the rebuild that is
    // supposed to honor it.
    if (key !== null) {
      this.pendingKey = key;
    }
  }

  /** Asks for `key` to receive focus as soon as it is rebuilt. */
  request(key: string): void {
    this.pendingKey = key;
    this.requestOutranksNextCapture = true;
  }

  /** Tags `element` with `key`, focusing it when it is the pending target. */
  register(key: string, element: HTMLElement): void {
    element.setAttr(FOCUS_KEY_ATTRIBUTE, key);
    if (this.pendingKey !== key) {
      return;
    }

    element.focus();
    // Consume the request only once focus actually landed. An element that is
    // disabled, or not yet attached, silently ignores focus() — clearing the
    // request before confirming would mean nothing ever retries on the next
    // render, which is the bug the old one-shot `shouldFocusCustomPath` flag
    // had.
    if (isFocused(element)) {
      this.pendingKey = null;
      this.requestOutranksNextCapture = false;
    }
  }
}

function activeFocusKey(): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  return document.activeElement?.getAttribute(FOCUS_KEY_ATTRIBUTE) ?? null;
}

function isFocused(element: HTMLElement): boolean {
  // Obsidian plugins only ever run inside a real Electron window, and this
  // package's tests run under jsdom, so there is normally a document to ask.
  // A missing document (a consumer running these modules under bare Node)
  // means "no way to confirm", so treat the focus() call as landed rather
  // than retrying on every subsequent render forever.
  if (typeof document === "undefined") {
    return true;
  }

  return document.activeElement === element;
}
