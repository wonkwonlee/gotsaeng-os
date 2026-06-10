import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  HIDDEN_OUTPUT_FOLDER,
  assertValidOutputFolderPath,
  VISIBLE_OUTPUT_FOLDER,
  getSettingsValidationMessages,
  isHiddenOutputFolder,
  normalizeOutputFolder,
  normalizeOutputFolderVisibility,
  normalizeSettings,
  normalizeStaleDays,
  updateSettingsWithCustomOutputFolderInput,
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
