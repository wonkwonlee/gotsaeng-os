# Obsidian Community Plugin Submission — GotSaeng OS

> **Process update (2026-06):** Obsidian no longer accepts pull requests to
> `obsidianmd/obsidian-releases` (the repo has PR creation disabled). Submissions go through
> the **community directory portal** at <https://community.obsidian.md>. The portal reads
> `manifest.json` from the HEAD of the repository's default branch and verifies the matching
> GitHub release.

---

## Pre-submission checklist

- [x] `apps/obsidian-plugin/manifest.json` `version` == `0.10.3`
- [x] `apps/obsidian-plugin/versions.json` contains key `"0.10.3"`
- [x] All five `package.json` files have `"version": "0.10.3"`
- [x] Git tag `0.10.3` on the public repo (NO `v` prefix — must exactly match manifest version)
- [x] GitHub release `0.10.3` with assets: `main.js`, `manifest.json`, `styles.css`
- [x] Release assets are from `apps/obsidian-plugin/dist/` after a clean `pnpm build`
- [x] `pnpm typecheck && pnpm test && pnpm build && pnpm lint` pass on the tagged commit
- [x] Public repo has `README.md` and `LICENSE` (MIT) at the root
- [x] `manifest.json` `id` (`gotsaeng-os`) does not contain the word "obsidian"

## Submission steps (portal)

1. Go to <https://community.obsidian.md> and sign in with an Obsidian account.
2. Link the GitHub account that owns `wonkwonlee/gotsaeng-os` (ownership verification).
3. Navigate to **Plugins → New plugin**.
4. Enter the repository URL: `https://github.com/wonkwonlee/gotsaeng-os`
5. Agree to the [Developer policies](https://docs.obsidian.md/Developer+policies).
6. Select **Submit**.
7. The directory runs automated review checks. Address any feedback by fixing the code,
   bumping the version (lockstep, see `docs/release.md`), tagging, and cutting a new release —
   the portal picks up the latest release automatically.

**Review is not done at "submitted" — shepherd the submission through automated and human
feedback until the plugin is listed.**

---

## isDesktopOnly justification (for review feedback)

`isDesktopOnly: true` because:

1. **Node.js `fs` module** — the core compiler (`@gotsaeng/core`) reads vault files using Node's
   `fs` API via `fast-glob`, which is unavailable in the Obsidian mobile environment.
2. **Local vault path access** — the plugin compiles an on-disk vault directory; mobile Obsidian
   does not expose a writable local filesystem path in the same way.
3. **No mobile code path exists** — there is no fallback or mobile-safe implementation; shipping
   the plugin on mobile would result in immediate failure at compile time.

## Plugin description (used in the directory listing)

```
Compile your local Markdown vault into a structured context pack for LLM-assisted workflows.
Local-first, no telemetry, no cloud, no LLM API calls.
```

Provenance scoring, confidence scoring, and contradiction detection are deterministic heuristics
based on note metadata and keyword analysis. They are not semantic AI verification — keep this
framing in any reviewer correspondence to avoid overclaiming.

---

## Post-listing

Once admitted to the community directory:

- Announce in the [Obsidian forum Share & Showcase](https://forum.obsidian.md/c/share-showcase/9).
- Announce on the Obsidian Discord `#updates` channel (requires the `developer` role).
- Proceed with the broader launch plan in `docs/launch.md`.
