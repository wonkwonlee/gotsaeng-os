import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  HIDDEN_OUTPUT_FOLDER,
  assertValidOutputFolderPath,
  VISIBLE_OUTPUT_FOLDER,
  getPersistedSettingsIssues,
  getSettingsValidationMessages,
  isHiddenOutputFolder,
  normalizeManagedOutputFolders,
  normalizeOutputFolder,
  normalizeOutputFolderVisibility,
  normalizeSettings,
  normalizeStaleDays,
  pruneManagedOutputFolders,
  updateSettingsWithCustomOutputFolderInput,
  updateSettingsWithOutputFolderVisibility,
  updateSettingsWithStaleDaysInput,
  resolveOutputFolderForVisibility,
  validateCustomOutputFolderInput,
  validateOutputFolderPath,
  validateStaleDaysInput,
} from "../src/settings";

describe("Obsidian plugin settings", () => {
  it("normalizes empty settings to defaults", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("does not grandfather the hidden folder into managedOutputFolders for settings that predate the field", () => {
    // A data.json from before managedOutputFolders existed has no such field.
    // A vault that has always used the visible or a custom folder must not
    // have the hidden folder marked managed on migration — that would make
    // routine cleanup sweep a folder this plugin instance never wrote to.
    expect(normalizeManagedOutputFolders(undefined, VISIBLE_OUTPUT_FOLDER)).toEqual([
      VISIBLE_OUTPUT_FOLDER,
    ]);
    expect(normalizeManagedOutputFolders(undefined, "Reports/GotSaeng")).toEqual([
      "Reports/GotSaeng",
    ]);

    const migrated = normalizeSettings({
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });
    expect(migrated.managedOutputFolders).toEqual([VISIBLE_OUTPUT_FOLDER]);
    expect(migrated.managedOutputFolders).not.toContain(HIDDEN_OUTPUT_FOLDER);
  });

  it("drops blank managed-folder entries instead of normalizing them into the hidden folder (#13)", () => {
    // normalizeOutputFolder("") resolves to the *default* (hidden) folder, so
    // a blank entry that slipped into persisted data used to grandfather the
    // hidden folder into the managed set — marking it sweepable in a vault
    // that may never have used it.
    expect(normalizeManagedOutputFolders(["", "   "], VISIBLE_OUTPUT_FOLDER)).toEqual([
      VISIBLE_OUTPUT_FOLDER,
    ]);
    expect(
      normalizeSettings({
        outputFolderVisibility: "visible",
        outputFolder: VISIBLE_OUTPUT_FOLDER,
        managedOutputFolders: [""],
      }).managedOutputFolders,
    ).not.toContain(HIDDEN_OUTPUT_FOLDER);
  });

  it("prunes managed folders that no longer exist, always keeping the folder in use (#10)", () => {
    // The set is append-only otherwise: normalizeManagedOutputFolders folds the
    // folder in use into it on every save, so a vault that has moved its output
    // folder repeatedly keeps every folder it ever used forever.
    expect(
      pruneManagedOutputFolders(
        [HIDDEN_OUTPUT_FOLDER, "Reports/Gone", VISIBLE_OUTPUT_FOLDER],
        VISIBLE_OUTPUT_FOLDER,
        [HIDDEN_OUTPUT_FOLDER],
      ),
    ).toEqual([HIDDEN_OUTPUT_FOLDER, VISIBLE_OUTPUT_FOLDER]);

    // The folder in use is kept even before it has been created on disk.
    expect(pruneManagedOutputFolders(["Reports/New"], "Reports/New", [])).toEqual(["Reports/New"]);
  });

  it("keeps output folders relative to the vault", () => {
    expect(normalizeOutputFolder("/reports/gotsaeng/")).toBe("reports/gotsaeng");
    expect(normalizeOutputFolder("")).toBe(DEFAULT_SETTINGS.outputFolder);
  });

  it("migrates known output folders to visibility modes", () => {
    expect(normalizeOutputFolderVisibility(undefined, HIDDEN_OUTPUT_FOLDER)).toBe("hidden");
    expect(normalizeOutputFolderVisibility(undefined, VISIBLE_OUTPUT_FOLDER)).toBe("visible");
    expect(normalizeOutputFolderVisibility(undefined, "Reports/GotSaeng")).toBe("custom");
    expect(resolveOutputFolderForVisibility("hidden", "Reports/GotSaeng")).toBe(
      HIDDEN_OUTPUT_FOLDER,
    );
    expect(resolveOutputFolderForVisibility("visible", "Reports/GotSaeng")).toBe(
      VISIBLE_OUTPUT_FOLDER,
    );
    expect(resolveOutputFolderForVisibility("custom", "Reports/GotSaeng")).toBe("Reports/GotSaeng");
  });

  it("detects dot-folder output paths as hidden", () => {
    expect(isHiddenOutputFolder(".gotsaeng/context-pack")).toBe(true);
    expect(isHiddenOutputFolder("Reports/.gotsaeng/context-pack")).toBe(true);
    expect(isHiddenOutputFolder("Gotsaeng/Context Pack")).toBe(false);
  });

  it("falls back to the default stale threshold for invalid values", () => {
    expect(normalizeStaleDays(30)).toBe(30);
    expect(normalizeStaleDays(0)).toBe(DEFAULT_SETTINGS.staleDays);
    expect(normalizeStaleDays(Number.NaN)).toBe(DEFAULT_SETTINGS.staleDays);
  });
  it("surfaces custom output folder validation messages", () => {
    expect(validateCustomOutputFolderInput("Reports/GotSaeng")).toEqual([]);
    const absolutePathMessage =
      "Output folder must be vault-relative; absolute paths are not supported.";
    expect(validateCustomOutputFolderInput("/absolute/path")).toEqual([absolutePathMessage]);
    expect(validateCustomOutputFolderInput("C:/absolute/path")).toEqual([absolutePathMessage]);
    expect(validateCustomOutputFolderInput("C:\\absolute\\path")).toEqual([absolutePathMessage]);
    expect(validateCustomOutputFolderInput("D:outside")).toEqual([absolutePathMessage]);
    expect(validateCustomOutputFolderInput("")).toEqual(["Custom output folder cannot be empty."]);
    expect(validateCustomOutputFolderInput("../outside")).toEqual([
      "Output folder cannot include '..' path segments.",
    ]);
    expect(validateOutputFolderPath("Reports/GotSaeng")).toEqual([]);
    expect(() => assertValidOutputFolderPath("../outside")).toThrow(
      "Output folder cannot include '..' path segments.",
    );
    expect(
      getSettingsValidationMessages({
        ...DEFAULT_SETTINGS,
        outputFolderVisibility: "custom",
        outputFolder: "../outside",
      }),
    ).toEqual(["Output folder cannot include '..' path segments."]);
  });

  it("reports what a persisted settings object had to be normalized out of", () => {
    // normalizeSettings coerces these away before anything sees them, so the
    // raw persisted object is the only place the problem still exists — which
    // is why the settings banner has to be fed from here, not from the
    // already-normalized live settings.
    expect(
      getPersistedSettingsIssues({
        outputFolderVisibility: "custom",
        outputFolder: "../outside",
        staleDays: 0,
      }),
    ).toEqual([
      "Saved output folder path was reset to the default. Output folder cannot include '..' path segments.",
      `Saved stale days value was reset to ${DEFAULT_SETTINGS.staleDays}. Stale days must be a positive whole number.`,
    ]);

    // A built-in folder is not a custom path, so its value is never validated
    // as one; a valid custom path and a valid stale-days value report nothing;
    // and absent fields are not a reset (they were never set).
    expect(getPersistedSettingsIssues({})).toEqual([]);
    expect(
      getPersistedSettingsIssues({ outputFolderVisibility: "hidden", outputFolder: "" }),
    ).toEqual([]);
    expect(
      getPersistedSettingsIssues({
        outputFolderVisibility: "custom",
        outputFolder: "Reports/GotSaeng",
        staleDays: 30,
      }),
    ).toEqual([]);
  });

  it("rejects invalid values through settings update helpers", () => {
    const currentSettings = {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "custom" as const,
      outputFolder: "Reports/GotSaeng",
      staleDays: 90,
    };

    expect(updateSettingsWithCustomOutputFolderInput(currentSettings, "/absolute/path")).toBeNull();
    expect(
      updateSettingsWithCustomOutputFolderInput(currentSettings, "C:/absolute/path"),
    ).toBeNull();
    expect(
      updateSettingsWithCustomOutputFolderInput(currentSettings, "C:\\absolute\\path"),
    ).toBeNull();
    expect(updateSettingsWithCustomOutputFolderInput(currentSettings, "D:outside")).toBeNull();
    expect(updateSettingsWithCustomOutputFolderInput(currentSettings, "../outside")).toBeNull();
    expect(updateSettingsWithCustomOutputFolderInput(currentSettings, "Reports/New Pack")).toEqual({
      ...currentSettings,
      outputFolderVisibility: "custom",
      outputFolder: "Reports/New Pack",
    });

    expect(updateSettingsWithStaleDaysInput(currentSettings, "1.5")).toBeNull();
    expect(updateSettingsWithStaleDaysInput(currentSettings, "30abc")).toBeNull();
    expect(updateSettingsWithStaleDaysInput(currentSettings, "30")).toEqual({
      ...currentSettings,
      staleDays: 30,
    });
  });

  it("does not silently repair invalid persisted custom output folders", () => {
    expect(
      normalizeSettings({
        outputFolderVisibility: "custom",
        outputFolder: "/absolute/path",
      }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        outputFolderVisibility: "custom",
        outputFolder: "C:/absolute/path",
      }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        outputFolderVisibility: "custom",
        outputFolder: "D:outside",
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it("switches output folder visibility to the matching managed folder", () => {
    const customSettings = {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "custom" as const,
      outputFolder: "Reports/GotSaeng",
    };

    expect(updateSettingsWithOutputFolderVisibility(customSettings, "hidden")).toEqual({
      ...customSettings,
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });
    expect(updateSettingsWithOutputFolderVisibility(customSettings, "visible")).toEqual({
      ...customSettings,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });
  });

  it("surfaces stale-day validation messages", () => {
    expect(validateStaleDaysInput("30")).toEqual([]);
    expect(validateStaleDaysInput("0")).toEqual([
      "Stale days must be a positive whole number; the default threshold will be used.",
    ]);
    expect(validateStaleDaysInput("not-a-number")).toEqual([
      "Stale days must be a positive whole number; the default threshold will be used.",
    ]);
    expect(validateStaleDaysInput("1.5")).toEqual([
      "Stale days must be a positive whole number; the default threshold will be used.",
    ]);
    expect(validateStaleDaysInput("30abc")).toEqual([
      "Stale days must be a positive whole number; the default threshold will be used.",
    ]);
  });
});
