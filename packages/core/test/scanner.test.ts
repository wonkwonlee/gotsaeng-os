import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanMarkdownFiles } from "../src/index";

describe("scanner", () => {
  it("ignores Obsidian internals and generated GotSaeng output", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-"));
    await fs.mkdir(path.join(vaultDir, ".obsidian/plugins/gotsaeng-os"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, ".gotsaeng/context-pack"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });

    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, ".obsidian/plugins/gotsaeng-os/README.md"), "# Plugin", "utf8");
    await fs.writeFile(path.join(vaultDir, ".gotsaeng/context-pack/PROJECT_CONTEXT.md"), "# Context", "utf8");

    const files = await scanMarkdownFiles(vaultDir);

    expect(files.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
  });
});
