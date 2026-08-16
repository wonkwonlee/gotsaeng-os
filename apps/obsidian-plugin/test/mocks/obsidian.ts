// Hand-rolled runtime stand-in for the "obsidian" npm package.
//
// The published "obsidian" dependency ships only `obsidian.d.ts` (its
// package.json sets `"main": ""`). A real Obsidian plugin never actually
// bundles "obsidian" — the host Electron app supplies it at load time — so
// under Node/vitest there is nothing for `import ... from "obsidian"` to
// resolve to at runtime. This module is aliased in its place (see root
// vitest.config.ts, `resolve.alias.obsidian`) so apps/obsidian-plugin/src
// files can be exercised under vitest.
//
// `tsc` never sees this alias — it type-checks `import ... from "obsidian"`
// against the real ambient obsidian.d.ts declarations exactly as before, so
// this file does not need to structurally satisfy those (large) interfaces.
// It only implements the small slice of Obsidian runtime behavior that
// apps/obsidian-plugin/src/main.ts and view.ts actually call.
//
// Keep this honest: if a source file starts using more of the Obsidian API,
// extend this mock to match rather than casting the gap away in tests.
//
// DOM: elements here are REAL jsdom elements (this package's tests run with
// `environment: "jsdom"` — see root vitest.config.ts), augmented on
// HTMLElement.prototype with the small `createEl`/`createDiv`/`empty`/… DOM
// builder surface Obsidian adds to HTMLElement in the real app, plus a few
// test-only query helpers. This used to be a hand-rolled `FakeElement` object
// graph with a bare `focusCount` counter and no notion of an active element —
// which meant src/a11y.ts's `activeFocusKey()` always returned null and both
// `capture()` and `isFocused()` were provably no-ops under test (neutering
// either guard left every test green). Backing the mock with real elements is
// what makes focus restoration assertable at all: `document.activeElement` is
// real, `data-focus-key` is a real queryable attribute, removing a focused
// element really drops focus, and disabling a focused control really blurs it.

/** An Obsidian-augmented DOM element: structurally a real `HTMLElement`, plus
 * the few extras below. The `createEl`/`createDiv`/`empty`/`setText`/`addClass`
 * /`setAttr`/`getAttr`/`hide`/`show`/`toggle` surface is NOT redeclared here —
 * obsidian.d.ts already augments the global `HTMLElement` with all of it, which
 * is exactly what makes `installObsidianDomAugmentation` a faithful stand-in
 * rather than a parallel object model. */
export type FakeElement = Omit<HTMLElement, "children"> & {
  /** Lowercased tag name, e.g. `"button"`. */
  readonly tag: string;
  /** Text set explicitly via `createEl({text})`/`setText()`; `undefined` when
   * this element was never given text of its own. Deliberately NOT
   * `textContent`: a container whose children carry text has no text of its
   * own, and several assertions depend on that distinction. */
  text: string | undefined;
  /** This element's class names, as an array. */
  readonly cls: string[];
  /** Child *elements*, as an array (the real `children` is an HTMLCollection). */
  readonly children: FakeElement[];
  value: string;
  disabled: boolean;
  type: string;
  min: string;
  /** Test helper: how many times `focus()` has been called on this element.
   * Says nothing about whether focus actually landed — assert
   * `document.activeElement` for that. */
  readonly focusCount: number;
  /** Test helper: dispatch a plain DOM event of `type` at this element. */
  dispatch(type: string): void;
  /** Test helper: first descendant carrying `cls`, in document order. */
  findByClass(cls: string): FakeElement | undefined;
  /** Test helper: all descendants carrying `cls`, in document order. */
  findAllByClass(cls: string): FakeElement[];
  /** Test helper: all descendants with the given tag name, in document order. */
  findAllByTag(tag: string): FakeElement[];
};

export type CreateElOptions = {
  text?: string;
  cls?: string | string[];
  attr?: Record<string, string | number | boolean | null>;
};

const OWN_TEXT = Symbol("gotsaeng.ownText");
const FOCUS_COUNT = Symbol("gotsaeng.focusCount");

type Augmented = HTMLElement & {
  [OWN_TEXT]?: string | undefined;
  [FOCUS_COUNT]?: number;
};

function asFake(element: Element): FakeElement {
  return element as unknown as FakeElement;
}

// Installed once, at module load. Obsidian augments HTMLElement.prototype the
// same way in the real app, so src/ code calling `el.createDiv(...)` on a
// plain HTMLElement is exactly what happens in production.
function installObsidianDomAugmentation(): void {
  const proto = HTMLElement.prototype as unknown as Record<PropertyKey, unknown>;
  if (proto["createEl"] !== undefined) {
    return;
  }

  Object.defineProperties(HTMLElement.prototype, {
    tag: {
      configurable: true,
      get(this: HTMLElement): string {
        return this.tagName.toLowerCase();
      },
    },
    text: {
      configurable: true,
      get(this: Augmented): string | undefined {
        return this[OWN_TEXT];
      },
      set(this: Augmented, value: string | undefined) {
        this[OWN_TEXT] = value;
        this.textContent = value ?? "";
      },
    },
    cls: {
      configurable: true,
      get(this: HTMLElement): string[] {
        return [...this.classList];
      },
    },
    children: {
      configurable: true,
      get(this: HTMLElement): FakeElement[] {
        return [...this.childNodes]
          .filter((node): node is Element => node.nodeType === 1)
          .map(asFake);
      },
    },
    focusCount: {
      configurable: true,
      get(this: Augmented): number {
        return this[FOCUS_COUNT] ?? 0;
      },
    },
  });

  Object.assign(HTMLElement.prototype, {
    createEl(this: HTMLElement, tag: string, options?: CreateElOptions): FakeElement {
      const el = asFake(this.ownerDocument.createElement(tag));
      if (options?.text !== undefined) {
        el.setText(options.text);
      }
      if (options?.cls) {
        el.addClass(...(Array.isArray(options.cls) ? options.cls : [options.cls]));
      }
      if (options?.attr) {
        for (const [name, attrValue] of Object.entries(options.attr)) {
          if (attrValue !== null) {
            el.setAttr(name, attrValue);
          }
        }
      }
      this.appendChild(el);
      return el;
    },

    createDiv(this: FakeElement, options?: CreateElOptions): FakeElement {
      return asFake(this.createEl("div", options));
    },

    empty(this: Augmented): void {
      // Real removal, not a bookkeeping reset: dropping a focused descendant
      // has to really drop focus, which is precisely what FocusRestorer exists
      // to recover from.
      while (this.firstChild) {
        this.removeChild(this.firstChild);
      }
      this[OWN_TEXT] = undefined;
    },

    addClass(this: HTMLElement, ...classes: string[]): void {
      this.classList.add(...classes);
    },

    removeClass(this: HTMLElement, ...classes: string[]): void {
      this.classList.remove(...classes);
    },

    setText(this: FakeElement, value: string): void {
      this.text = value;
    },

    setAttr(this: HTMLElement, name: string, value: string | number | boolean): void {
      this.setAttribute(name, String(value));
    },

    getAttr(this: HTMLElement, name: string): string | null {
      return this.getAttribute(name);
    },

    hide(this: HTMLElement): void {
      this.hidden = true;
    },

    show(this: HTMLElement): void {
      this.hidden = false;
    },

    toggle(this: HTMLElement, show: boolean): void {
      this.hidden = !show;
    },

    dispatch(this: HTMLElement, type: string): void {
      this.dispatchEvent(new Event(type));
    },

    findByClass(this: HTMLElement, cls: string): FakeElement | undefined {
      const match = this.querySelector(`.${cls}`);
      return match === null ? undefined : asFake(match);
    },

    findAllByClass(this: HTMLElement, cls: string): FakeElement[] {
      return [...this.querySelectorAll(`.${cls}`)].map(asFake);
    },

    findAllByTag(this: HTMLElement, tag: string): FakeElement[] {
      return [...this.querySelectorAll(tag)].map(asFake);
    },
  });

  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function focus(this: Augmented, options?: FocusOptions): void {
    this[FOCUS_COUNT] = (this[FOCUS_COUNT] ?? 0) + 1;
    nativeFocus.call(this, options);
  };

  installDisabledBlursFocus();
}

// Browsers run the "focus fixup rule" when the focused element becomes
// disabled: focus moves off it to the body. jsdom reflects `disabled` to the
// attribute but does not run that fixup, and the Report Hub depends on it —
// starting a command disables all four action buttons, which is exactly what
// blurs the one the user clicked. Without this, a test could never tell
// whether focus was recorded before or after the buttons were disabled.
function installDisabledBlursFocus(): void {
  const constructors = [
    HTMLButtonElement,
    HTMLInputElement,
    HTMLSelectElement,
    HTMLTextAreaElement,
  ];

  for (const ctor of constructors) {
    const descriptor = Object.getOwnPropertyDescriptor(ctor.prototype, "disabled");
    const nativeGet = descriptor?.get;
    const nativeSet = descriptor?.set;
    if (!nativeGet || !nativeSet) {
      continue;
    }

    Object.defineProperty(ctor.prototype, "disabled", {
      configurable: true,
      enumerable: descriptor.enumerable ?? true,
      get: nativeGet,
      set(this: HTMLElement, value: boolean) {
        // Blur first: jsdom's blur() is a no-op on an element that is no
        // longer focusable, so doing it after the flag lands would silently
        // leave document.activeElement pointing at a disabled control.
        if (value && this.ownerDocument.activeElement === this) {
          this.blur();
        }
        nativeSet.call(this, value);
      },
    });
  }
}

installObsidianDomAugmentation();

/** Creates a detached-from-any-fixture root element attached to
 * `document.body`. Attachment matters: jsdom only moves
 * `document.activeElement` onto elements that are actually in the document,
 * so a mock whose roots float free would silently make every focus assertion
 * vacuous again. */
export function createRootElement(tag = "div"): FakeElement {
  const el = asFake(document.createElement(tag));
  document.body.appendChild(el);
  return el;
}

export class Notice {
  readonly message: string;

  constructor(message: string) {
    this.message = message;
    recordedNotices.push(this);
  }
}

/** Every `Notice` constructed since the last `resetNotices()`. */
export const recordedNotices: Notice[] = [];

export function resetNotices(): void {
  recordedNotices.length = 0;
}

export class Component {
  load(): void {}
  onload(): void {}
  unload(): void {}
  onunload(): void {}
}

export type FakeCommand = {
  id: string;
  name: string;
  callback?: () => void;
};

export type ViewCreator = (leaf: unknown) => View;

export class Plugin extends Component {
  app: unknown;
  manifest: unknown;
  settings?: unknown;

  readonly commands: FakeCommand[] = [];
  readonly ribbonIcons: Array<{ icon: string; title: string; callback: (evt: unknown) => void }> =
    [];
  settingTab: PluginSettingTab | null = null;
  readonly registeredViews = new Map<string, ViewCreator>();
  /** Test helper: what the last `saveData()` call persisted. */
  savedData: unknown = null;

  constructor(app: unknown, manifest: unknown) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  addSettingTab(settingTab: PluginSettingTab): void {
    this.settingTab = settingTab;
  }

  registerView(type: string, viewCreator: ViewCreator): void {
    this.registeredViews.set(type, viewCreator);
  }

  addRibbonIcon(icon: string, title: string, callback: (evt: unknown) => void): FakeElement {
    this.ribbonIcons.push({ icon, title, callback });
    return createRootElement("div");
  }

  addCommand(command: FakeCommand): FakeCommand {
    this.commands.push(command);
    return command;
  }

  addStatusBarItem(): FakeElement {
    return createRootElement("div");
  }

  async loadData(): Promise<unknown> {
    return this.savedData;
  }

  async saveData(data: unknown): Promise<void> {
    this.savedData = data;
  }
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  readonly containerEl: FakeElement = createRootElement("div");

  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {}
  hide(): void {}
  // Real SettingTab.update() re-fetches getSettingDefinitions() and
  // re-renders; GotSaengSettingTab calls it as the declarative-API
  // equivalent of display() (see its class-level comment in src/main.ts).
  // Tests that need to observe its effect call getSettingDefinitions()
  // themselves rather than relying on this mock to re-render anything.
  update(): void {}
}

export class FakeTextComponent {
  readonly inputEl: FakeElement;
  private value = "";
  private changeHandler: ((value: string) => unknown) | null = null;

  constructor(parent: FakeElement) {
    this.inputEl = asFake(parent.createEl("input"));
  }

  setPlaceholder(): this {
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    // Real TextComponent wraps a live <input>; other code (e.g. blur
    // handlers) reads the current value straight off `inputEl.value`, not
    // through this component, so keep the two in sync.
    this.inputEl.value = value;
    return this;
  }

  getValue(): string {
    return this.value;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  /** Test helper: simulate the user typing/committing a new value. */
  async emitChange(value: string): Promise<void> {
    this.value = value;
    this.inputEl.value = value;
    await this.changeHandler?.(value);
  }
}

export class FakeDropdownComponent {
  readonly selectEl: FakeElement;
  readonly options: Array<{ value: string; display: string }> = [];
  private value = "";
  private changeHandler: ((value: string) => unknown) | null = null;

  constructor(parent: FakeElement) {
    this.selectEl = asFake(parent.createEl("select"));
  }

  addOption(value: string, display: string): this {
    this.options.push({ value, display });
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  getValue(): string {
    return this.value;
  }

  onChange(callback: (value: string) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  async emitChange(value: string): Promise<void> {
    this.value = value;
    await this.changeHandler?.(value);
  }
}

export class FakeToggleComponent {
  readonly toggleEl: FakeElement;
  private value = false;
  private changeHandler: ((value: boolean) => unknown) | null = null;

  constructor(parent: FakeElement) {
    // Obsidian's toggle is a focusable <div role="checkbox">, not an <input>;
    // the explicit tabindex is what makes it focusable in jsdom too.
    this.toggleEl = asFake(
      parent.createDiv({ cls: "checkbox-container", attr: { role: "checkbox", tabindex: "0" } }),
    );
  }

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }

  getValue(): boolean {
    return this.value;
  }

  onChange(callback: (value: boolean) => unknown): this {
    this.changeHandler = callback;
    return this;
  }

  async emitChange(value: boolean): Promise<void> {
    this.value = value;
    await this.changeHandler?.(value);
  }
}

export class Setting {
  readonly containerEl: FakeElement;
  /** The row element the real Setting builds inside `containerEl`; the
   * settings tab attaches its own per-field error region and status block to
   * it. */
  readonly settingEl: FakeElement;
  /** Where the real Setting puts the controls added by addText/addDropdown/
   * addToggle. Components are built inside it (rather than floating free) so
   * their elements are actually in the document and can hold focus. */
  readonly controlEl: FakeElement;
  name = "";
  desc = "";
  /** True once `setHeading()` has been called: the real Setting turns the row
   * into a section heading instead of a labelled control row. */
  isHeading = false;
  readonly textComponents: FakeTextComponent[] = [];
  readonly dropdownComponents: FakeDropdownComponent[] = [];
  readonly toggleComponents: FakeToggleComponent[] = [];

  constructor(containerEl: FakeElement) {
    this.containerEl = containerEl;
    this.settingEl = asFake(containerEl.createDiv({ cls: "setting-item" }));
    this.controlEl = asFake(this.settingEl.createDiv({ cls: "setting-item-control" }));
    createdSettings.push(this);
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setHeading(): this {
    this.isHeading = true;
    this.settingEl.addClass("setting-item-heading");
    return this;
  }

  addText(callback: (component: FakeTextComponent) => void): this {
    const component = new FakeTextComponent(this.controlEl);
    this.textComponents.push(component);
    callback(component);
    return this;
  }

  addDropdown(callback: (component: FakeDropdownComponent) => void): this {
    const component = new FakeDropdownComponent(this.controlEl);
    this.dropdownComponents.push(component);
    callback(component);
    return this;
  }

  addToggle(callback: (component: FakeToggleComponent) => void): this {
    const component = new FakeToggleComponent(this.controlEl);
    this.toggleComponents.push(component);
    callback(component);
    return this;
  }
}

/** Every `Setting` constructed since the last `resetCreatedSettings()`, in
 * creation order — lets tests inspect a settings tab's `display()` output
 * without needing to hand-query the whole document. */
export const createdSettings: Setting[] = [];

export function resetCreatedSettings(): void {
  createdSettings.length = 0;
}

export class TAbstractFile {
  path: string;
  name: string;

  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

export class TFile extends TAbstractFile {}

export class View extends Component {
  app: unknown;
  leaf: unknown;
  /** Real `View.onResize()` is called by the host when the leaf is resized;
   * the Report Hub overrides it (see syncPaneHeight in src/view.ts), so the
   * base method has to exist for tests to call the override through it. */
  onResize(): void {}
  readonly containerEl: FakeElement = createRootElement("div");
  readonly contentEl: FakeElement;
  icon = "";
  navigation = true;

  constructor(leaf: unknown) {
    super();
    this.leaf = leaf;
    this.app = (leaf as { app?: unknown } | undefined)?.app;
    this.contentEl = asFake(this.containerEl.createDiv());
  }
}

// Not exercised by src/view.ts (it wires its own buttons via `contentEl`,
// never `ItemView.addAction`), so the mock only needs to be a usable base
// class here — no method surface to fake.
export class ItemView extends View {}

export class Modal {
  app: unknown;
  readonly containerEl: FakeElement = createRootElement("div");
  readonly contentEl: FakeElement;
  readonly titleEl: FakeElement;

  constructor(app: unknown) {
    this.app = app;
    this.contentEl = asFake(this.containerEl.createDiv());
    this.titleEl = asFake(this.containerEl.createDiv());
  }

  setTitle(title: string): this {
    this.titleEl.setText(title);
    return this;
  }

  onOpen(): void {}
  onClose(): void {}

  open(): void {
    createdModals.push(this);
    this.onOpen();
  }

  close(): void {
    this.onClose();
  }
}

/** Every `Modal` opened since the last `resetCreatedModals()`, in open order. */
export const createdModals: Modal[] = [];

export function resetCreatedModals(): void {
  createdModals.length = 0;
}

export type RenderedMarkdown = {
  markdown: string;
  sourcePath: string;
  el: FakeElement;
};

/** Every `MarkdownRenderer.render()` call since the last `resetRenderedMarkdown()`. */
export const renderedMarkdown: RenderedMarkdown[] = [];

export function resetRenderedMarkdown(): void {
  renderedMarkdown.length = 0;
}

export class MarkdownRenderer {
  static async render(
    _app: unknown,
    markdown: string,
    el: unknown,
    sourcePath: string,
  ): Promise<void> {
    const target = el as FakeElement;
    renderedMarkdown.push({ markdown, sourcePath, el: target });
    const rendered = target.createDiv({ cls: "fake-markdown-rendered" });
    rendered.setText(markdown);
  }
}

/** Test helper: resets every piece of shared mutable mock state, including the
 * document itself — otherwise a focused, focus-keyed element left behind by
 * one test would still be `document.activeElement` when the next test's first
 * `FocusRestorer.capture()` runs. Call from `beforeEach`, before constructing
 * anything that builds DOM. */
export function resetObsidianMocks(): void {
  resetNotices();
  resetCreatedSettings();
  resetRenderedMarkdown();
  resetCreatedModals();
  document.body.replaceChildren();
}
