export type OutputFolderVisibility = "hidden" | "visible" | "custom";

export type GotSaengPluginSettings = {
  projectName: string;
  outputFolderVisibility: OutputFolderVisibility;
  outputFolder: string;
  // Folders this plugin instance has actually written to with user consent
  // (see applyOutputFolderChange in main.ts). Output-folder cleanup only ever
  // sweeps folders in this set (plus, when passed, the folder being vacated
  // right now) — being one of the two built-in folder *names* is no longer by
  // itself sufficient reason to sweep it. See getStaleManagedOutputFolders in
  // output-cleanup.ts.
  managedOutputFolders: string[];
  staleDays: number;
  strictValidation: boolean;
  openAfterCompile: boolean;
};

export const HIDDEN_OUTPUT_FOLDER = ".gotsaeng/context-pack";
export const VISIBLE_OUTPUT_FOLDER = "Gotsaeng/Context Pack";

export const DEFAULT_SETTINGS: GotSaengPluginSettings = {
  projectName: "GotSaeng OS",
  outputFolderVisibility: "hidden",
  outputFolder: HIDDEN_OUTPUT_FOLDER,
  managedOutputFolders: [HIDDEN_OUTPUT_FOLDER],
  staleDays: 90,
  strictValidation: false,
  openAfterCompile: true,
};

export function normalizeSettings(
  settings: Partial<GotSaengPluginSettings>,
): GotSaengPluginSettings {
  const rawOutputFolder = settings.outputFolder ?? "";
  const normalizedOutputFolder = normalizeOutputFolder(rawOutputFolder);
  const requestedVisibility = normalizeOutputFolderVisibility(
    settings.outputFolderVisibility,
    normalizedOutputFolder,
  );
  const validCustomOutputFolder = normalizeValidOutputFolder(rawOutputFolder);
  const outputFolderVisibility =
    requestedVisibility === "custom" && !validCustomOutputFolder
      ? DEFAULT_SETTINGS.outputFolderVisibility
      : requestedVisibility;

  const outputFolder = resolveOutputFolderForVisibility(
    outputFolderVisibility,
    validCustomOutputFolder ?? DEFAULT_SETTINGS.outputFolder,
  );

  return {
    projectName: normalizeProjectName(settings.projectName),
    outputFolderVisibility,
    outputFolder,
    managedOutputFolders: normalizeManagedOutputFolders(
      settings.managedOutputFolders,
      outputFolder,
    ),
    staleDays: normalizeStaleDays(settings.staleDays),
    strictValidation: settings.strictValidation ?? DEFAULT_SETTINGS.strictValidation,
    openAfterCompile: settings.openAfterCompile ?? DEFAULT_SETTINGS.openAfterCompile,
  };
}

// The currently active output folder is always trivially "managed" — folding
// it in here means every saveSettings() call (which routes through
// normalizeSettings) automatically records the folder-in-use as authorized
// for cleanup, without applyOutputFolderChange needing its own bookkeeping.
// When `value` is undefined (a data.json predating this field, or a fresh
// install), this starts from an *empty* set rather than
// DEFAULT_SETTINGS.managedOutputFolders (which seeds the hidden folder): a
// vault migrating from a pre-this-field version may have always used the
// visible or a custom folder, and grandfathering in the hidden folder too
// would mark it managed — and therefore swept — even though this plugin
// instance never wrote to it. Only `outputFolder`, added below, is known-safe
// to grandfather in.
export function normalizeManagedOutputFolders(
  value: string[] | undefined,
  outputFolder: string,
): string[] {
  const base = value ?? [];
  const normalized = new Set(base.map((folder) => normalizeOutputFolder(folder)));
  normalized.add(normalizeOutputFolder(outputFolder));
  return [...normalized];
}

export function normalizeProjectName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.projectName;
}

export function normalizeOutputFolder(value: string | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.outputFolder;
}

export function normalizeValidOutputFolder(value: string | undefined): string | null {
  const raw = value ?? "";
  if (validateOutputFolderPath(raw).length > 0) {
    return null;
  }

  return normalizeOutputFolder(raw);
}

export function normalizeOutputFolderVisibility(
  value: OutputFolderVisibility | undefined,
  outputFolder: string,
): OutputFolderVisibility {
  if (value === "hidden" || value === "visible" || value === "custom") {
    return value;
  }

  if (outputFolder === HIDDEN_OUTPUT_FOLDER) {
    return "hidden";
  }

  if (outputFolder === VISIBLE_OUTPUT_FOLDER) {
    return "visible";
  }

  return "custom";
}

export function resolveOutputFolderForVisibility(
  visibility: OutputFolderVisibility,
  customOutputFolder: string,
): string {
  if (visibility === "hidden") {
    return HIDDEN_OUTPUT_FOLDER;
  }

  if (visibility === "visible") {
    return VISIBLE_OUTPUT_FOLDER;
  }

  return customOutputFolder;
}

export function isHiddenOutputFolder(outputFolder: string): boolean {
  return outputFolder.split("/").some((segment) => segment.startsWith("."));
}

export function normalizeStaleDays(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_SETTINGS.staleDays;
  }

  return value;
}

export function validateOutputFolderPath(value: string): string[] {
  const trimmed = value.trim();
  const messages: string[] = [];

  if (!trimmed) {
    return ["Custom output folder cannot be empty."];
  }

  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    messages.push("Output folder must be vault-relative; absolute paths are not supported.");
  }

  if (normalized.split("/").some((segment) => segment === "..")) {
    messages.push("Output folder cannot include '..' path segments.");
  }

  return messages;
}

export function assertValidOutputFolderPath(value: string): void {
  const messages = validateOutputFolderPath(value);
  if (messages.length > 0) {
    throw new Error(messages.join(" "));
  }
}

export function validateCustomOutputFolderInput(value: string): string[] {
  return validateOutputFolderPath(value);
}

export function validateStaleDaysInput(value: string): string[] {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (!/^[1-9]\d*$/.test(trimmed) || !Number.isInteger(parsed)) {
    return ["Stale days must be a positive whole number; the default threshold will be used."];
  }

  return [];
}

export function updateSettingsWithCustomOutputFolderInput(
  settings: GotSaengPluginSettings,
  value: string,
): GotSaengPluginSettings | null {
  const outputFolder = normalizeValidOutputFolder(value);
  if (!outputFolder) {
    return null;
  }

  return {
    ...settings,
    outputFolderVisibility: "custom",
    outputFolder,
  };
}

export function updateSettingsWithOutputFolderVisibility(
  settings: GotSaengPluginSettings,
  visibility: "hidden" | "visible",
): GotSaengPluginSettings {
  return {
    ...settings,
    outputFolderVisibility: visibility,
    outputFolder: visibility === "hidden" ? HIDDEN_OUTPUT_FOLDER : VISIBLE_OUTPUT_FOLDER,
  };
}

export function updateSettingsWithStaleDaysInput(
  settings: GotSaengPluginSettings,
  value: string,
): GotSaengPluginSettings | null {
  if (validateStaleDaysInput(value).length > 0) {
    return null;
  }

  return {
    ...settings,
    staleDays: Number(value.trim()),
  };
}

export function getSettingsValidationMessages(settings: GotSaengPluginSettings): string[] {
  const messages: string[] = [];

  if (settings.outputFolderVisibility === "custom") {
    messages.push(...validateCustomOutputFolderInput(settings.outputFolder));
  }

  if (!Number.isInteger(settings.staleDays) || settings.staleDays <= 0) {
    messages.push("Stale days must be a positive whole number.");
  }

  return messages;
}
