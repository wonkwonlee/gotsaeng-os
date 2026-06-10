# Obsidian Manual Smoke Test

Run this checklist before tagging or publicly announcing a release that includes the Obsidian adapter.
The repository smoke script verifies build artifacts and stages a temporary plugin install, but Obsidian
itself must still be checked in the desktop app because plugin loading, settings persistence, command
registration, and preview UX are app-level behavior.

## Prerequisites

- Obsidian desktop app installed.
- A disposable local vault or a backed-up real vault.
- Repository quality gates have passed.
- `pnpm smoke:obsidian` has passed.

## Install the local build

Build and verify the local adapter artifacts:

```bash
pnpm smoke:obsidian
```

For a real vault install, copy the built files into the vault plugin directory:

```bash
mkdir -p "/path/to/vault/.obsidian/plugins/gotsaeng-os"
cp apps/obsidian-plugin/dist/main.js \
  apps/obsidian-plugin/dist/manifest.json \
  apps/obsidian-plugin/dist/styles.css \
  "/path/to/vault/.obsidian/plugins/gotsaeng-os/"
```

Restart Obsidian or disable/enable **GotSaeng OS** after copying files. Obsidian keeps loaded plugin
JavaScript in memory until the plugin is reloaded.

## App checklist

Record the vault path, Obsidian version, GotSaeng OS version, operating system, and date in the release
notes or PR when completing this checklist.

1. Open **Settings → Community plugins** and enable **GotSaeng OS**.
2. Confirm the plugin settings screen shows the current package version and the local-only/no-network
   privacy message.
3. Run **GotSaeng OS: Compile Context Pack** from the command palette.
4. Confirm `REPORT_HUB.md`, `CONTEXT_MANIFEST.json`, `COMPILE_REPORT.json`, and the main Markdown
   reports are generated.
5. Run **GotSaeng OS: Open Report Hub** and confirm Markdown/JSON previews open without errors.
6. Run **GotSaeng OS: Generate Weekly Review** and confirm the generated review appears in the selected
   output folder.
7. Run **GotSaeng OS: Export LLM Handoff** and confirm it writes a local Markdown handoff file without
   calling any external API.
8. Run **GotSaeng OS: Validate Vault Schema** and confirm warnings are readable.
9. Switch output visibility to **Visible vault folder** and compile again. Confirm output appears under
   `Gotsaeng/Context Pack`.
10. Switch output visibility to **Hidden system folder** and compile again. Confirm output appears under
    `.gotsaeng/context-pack`.
11. After each visibility switch, confirm stale GotSaeng-managed files from the previous built-in output
    folder are not duplicated. User-authored files in those folders must remain untouched.
12. Try invalid custom output paths such as `/tmp/outside`, `C:/outside`, `D:outside`, and `../outside`.
    Confirm the setting is rejected and the previous valid output folder remains active.
13. Try invalid stale-context thresholds such as `0`, `1.5`, and `30abc`. Confirm the previous valid value
    remains active.
14. Disable and re-enable the plugin, then confirm settings persist and commands still run.

## Pass criteria

The manual smoke passes only when:

- All commands complete without uncaught plugin errors.
- Generated files stay inside the vault.
- Output visibility changes do not leave duplicate GotSaeng-managed reports in both built-in folders.
- Invalid settings are rejected instead of silently normalized into unsafe paths or partial numbers.
- No network, telemetry, cloud sync, or LLM API behavior is observed.

If any item fails, do not tag or publish the release until the failure is fixed or explicitly documented as
a known limitation.
