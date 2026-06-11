# Launch Draft — GotSaeng OS 0.10.1

This is a working draft for launch copy. No posts have been submitted. All copy below is for
internal review before publishing.

**Honest framing requirements** (from ROADMAP and README):
- Provenance scoring, confidence scoring, and contradiction detection are **deterministic
  heuristics** based on note metadata and keyword patterns — not semantic AI verification.
- GotSaeng OS does not make LLM API calls. It is a local compiler, not an AI app.
- "Context pack" means structured Markdown + JSON files ready for a context window — not an
  automatic AI memory system.

---

## Show HN draft

**Title:** Show HN: GotSaeng OS – local-first context compiler for Markdown vaults

**Body:**

> GotSaeng OS compiles your Obsidian (or any Markdown) vault into a structured context pack: a
> set of named Markdown and JSON files ready to drop into an LLM context window or agent memory
> slot.
>
> It runs entirely on your machine — no telemetry, no cloud sync, no LLM API calls. One command:
>
>     npx -y @gotsaeng/cli compile ./my-vault --output ./out --project "My Project"
>
> It scans your notes for typed annotations (`fact:`, `decision:`, `action:`, `risk:`,
> `assumption:`, `question:`, `insight:`), scores provenance and confidence using deterministic
> heuristics (NOT semantic AI), flags potential contradictions by keyword patterns, and writes 13
> structured files to the output directory.
>
> The Obsidian plugin wraps the same CLI compiler and adds a Report Hub panel — no separate
> runtime.
>
> Repo: https://github.com/wonkwonlee/gotsaeng-os
> npm: `@gotsaeng/cli` and `@gotsaeng/core`
>
> Would love feedback on the annotation format, the output schema, and what would make a context
> pack genuinely useful in your handoff / agent workflows.

---

## r/ObsidianMD draft

**Title:** GotSaeng OS: compile your vault into a structured LLM context pack (local-first, no
telemetry, no cloud)

**Body:**

> I built GotSaeng OS to solve a specific problem: I keep detailed notes in Obsidian but have no
> structured way to hand them to an LLM for a project catchup or agent task.
>
> The plugin (and matching CLI) compiles your vault into a context pack — `PROJECT_CONTEXT.md`,
> `DECISION_LOG.md`, `ACTION_BACKLOG.md`, `RISK_REGISTER.md`, `SOURCE_PROVENANCE.md`, and more.
> Everything runs locally; nothing leaves your machine.
>
> **Honest caveats:** provenance and confidence scores are deterministic heuristics based on your
> note metadata and annotation patterns — not AI analysis. Contradiction detection flags keyword
> patterns, not semantic conflicts. The output is only as good as your annotation discipline.
>
> Install via the Obsidian community plugin browser (submission in review) or:
>
>     npx -y @gotsaeng/cli compile ./vault --output ./out --project "Name"
>
> Repo + examples: https://github.com/wonkwonlee/gotsaeng-os

---

## r/PKM draft

**Title:** I made a local compiler that turns annotated Markdown notes into structured context
files for LLMs

**Body:**

> The problem: I have years of notes in Obsidian. When I want to use an LLM for planning or
> handoff, I end up manually copy-pasting context, which is slow and lossy.
>
> GotSaeng OS is a CLI + Obsidian plugin that compiles your vault into structured files designed
> for LLM context windows. You annotate your notes with simple inline markers (`fact:`,
> `decision:`, `action:`, etc.) and the compiler extracts, scores, and organizes them.
>
> It's local-first: no API calls, no cloud, no subscriptions. The output is plain Markdown and
> JSON you own and can inspect.
>
> Caveats: scoring is heuristic (metadata + keywords), not AI. It works best with Obsidian-style
> vaults but the CLI runs on any Markdown directory.
>
> https://github.com/wonkwonlee/gotsaeng-os

---

## GitHub Discussion: Show and tell

**Title:** Show and tell — what are you compiling?

**Body:**

> GotSaeng OS 0.10.1 is out. If you've tried compiling your vault, I'd love to see:
>
> - What vault structure you're using
> - Which output files you find most useful for your LLM workflows
> - Any annotation patterns that work well (or don't)
> - Feature requests grounded in real use
>
> The compiler is intentionally minimal — no AI, no cloud, just a local transform from your notes
> to structured context. Would love to hear what "useful context pack" means for your actual
> workflows.

---

## Awesome-list targets

| List | Entry format | Status |
|---|---|---|
| [awesome-obsidian](https://github.com/kmaasrud/awesome-obsidian) | `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Local-first context compiler for Obsidian vaults.` | Draft — not submitted |
| [awesome-local-first](https://github.com/pubkey/awesome-local-first) | `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Compile Markdown vaults into structured LLM context packs, fully on-device.` | Draft — not submitted |
| [awesome-markdown](https://github.com/BubuAnabelas/awesome-markdown) | `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Context compiler that extracts typed annotations from Markdown into structured context packs.` | Draft — not submitted |

Submit each only after Phase 0 + Phase 1 quality gates are confirmed green and the README is
fully polished.

---

## Status tracking

| Channel | Gate | Status |
|---|---|---|
| Obsidian community PR | Fast gate (0.1 + 0.2 + tag + release assets) | Awaiting tag + GitHub release |
| Show HN | Full gate (Phase 0 + 1 all green) | Draft |
| r/ObsidianMD | Full gate | Draft |
| r/PKM | Full gate | Draft |
| GitHub Discussion | Full gate | Draft |
| awesome-obsidian PR | Full gate | Draft |
| awesome-local-first PR | Full gate | Draft |
| awesome-markdown PR | Full gate | Draft |
