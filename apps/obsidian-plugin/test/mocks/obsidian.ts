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

/** Minimal stand-in for Obsidian's HTMLElement DOM-builder augmentation
 * (createEl/createDiv/empty/addClass, etc). vitest runs with
 * `environment: "node"`, so there is no real DOM to lean on here either. */
export class FakeElement {
  readonly tag: string;
  text?: string;
  readonly cls: string[] = [];
  title = "";
  type = "";
  min = "";
  value = "";
  disabled = false;
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(tag: string) {
    this.tag = tag;
  }

  createEl(tag: string, options?: { text?: string; cls?: string | string[] }): FakeElement {
    const el = new FakeElement(tag);
    if (options?.text !== undefined) {
      el.text = options.text;
    }
    if (options?.cls) {
      el.addClass(...(Array.isArray(options.cls) ? options.cls : [options.cls]));
    }
    this.children.push(el);
    return el;
  }

  createDiv(options?: { cls?: string | string[] }): FakeElement {
    return this.createEl("div", options);
  }

  empty(): void {
    this.children.length = 0;
  }

  addClass(...classes: string[]): void {
    this.cls.push(...classes);
  }

  addEventListener(type: string, callback: () => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(callback);
    this.listeners.set(type, existing);
  }

  /** Test helper: simulate a DOM event dispatched to this element. */
  dispatch(type: string): void {
    for (const callback of this.listeners.get(type) ?? []) {
      callback();
    }
  }

  focus(): void {
    // No-op: real Obsidian focuses the underlying input; nothing to assert.
  }

  /** Test helper: depth-first search for a descendant carrying `cls`. */
  findByClass(cls: string): FakeElement | undefined {
    for (const child of this.children) {
      if (child.cls.includes(cls)) {
        return child;
      }
      const nested = child.findByClass(cls);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  /** Test helper: all descendants (any depth) carrying `cls`, in document order. */
  findAllByClass(cls: string): FakeElement[] {
    const matches: FakeElement[] = [];
    for (const child of this.children) {
      if (child.cls.includes(cls)) {
        matches.push(child);
      }
      matches.push(...child.findAllByClass(cls));
    }
    return matches;
  }

  /** Test helper: all descendants (any depth) with the given tag name, in document order. */
  findAllByTag(tag: string): FakeElement[] {
    const matches: FakeElement[] = [];
    for (const child of this.children) {
      if (child.tag === tag) {
        matches.push(child);
      }
      matches.push(...child.findAllByTag(tag));
    }
    return matches;
  }
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
    return new FakeElement("div");
  }

  addCommand(command: FakeCommand): FakeCommand {
    this.commands.push(command);
    return command;
  }

  addStatusBarItem(): FakeElement {
    return new FakeElement("div");
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
  readonly containerEl: FakeElement = new FakeElement("div");

  constructor(app: unknown, plugin: unknown) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {}
  hide(): void {}
}

export class FakeTextComponent {
  readonly inputEl = new FakeElement("input");
  private value = "";
  private changeHandler: ((value: string) => unknown) | null = null;

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
  readonly options: Array<{ value: string; display: string }> = [];
  private value = "";
  private changeHandler: ((value: string) => unknown) | null = null;

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
  private value = false;
  private changeHandler: ((value: boolean) => unknown) | null = null;

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
  name = "";
  desc = "";
  readonly textComponents: FakeTextComponent[] = [];
  readonly dropdownComponents: FakeDropdownComponent[] = [];
  readonly toggleComponents: FakeToggleComponent[] = [];

  constructor(containerEl: FakeElement) {
    this.containerEl = containerEl;
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

  addText(callback: (component: FakeTextComponent) => void): this {
    const component = new FakeTextComponent();
    this.textComponents.push(component);
    callback(component);
    return this;
  }

  addDropdown(callback: (component: FakeDropdownComponent) => void): this {
    const component = new FakeDropdownComponent();
    this.dropdownComponents.push(component);
    callback(component);
    return this;
  }

  addToggle(callback: (component: FakeToggleComponent) => void): this {
    const component = new FakeToggleComponent();
    this.toggleComponents.push(component);
    callback(component);
    return this;
  }
}

/** Every `Setting` constructed since the last `resetCreatedSettings()`, in
 * creation order — lets tests inspect a settings tab's `display()` output
 * without needing a real DOM to query. */
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
  readonly containerEl: FakeElement = new FakeElement("div");
  readonly contentEl: FakeElement;
  icon = "";
  navigation = true;

  constructor(leaf: unknown) {
    super();
    this.leaf = leaf;
    this.app = (leaf as { app?: unknown } | undefined)?.app;
    this.contentEl = this.containerEl.createDiv();
  }
}

// Not exercised by src/view.ts (it wires its own buttons via `contentEl`,
// never `ItemView.addAction`), so the mock only needs to be a usable base
// class here — no method surface to fake.
export class ItemView extends View {}

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
    rendered.text = markdown;
  }
}

/** Test helper: resets every piece of shared mutable mock state. Call from
 * `beforeEach` so notices/settings/renders from one test never leak into
 * the next. */
export function resetObsidianMocks(): void {
  resetNotices();
  resetCreatedSettings();
  resetRenderedMarkdown();
}
