# Project Context: GotSaeng OS

Generated: 2026-06-06T00:00:00.000Z

## Current Objective

Ship the v0.1 local-first context compiler as a credible open-source foundation.

Source: 01_projects/gotsaeng-os.md (explicit; Read from a project note objective section.)

## Key Facts

- GotSaeng OS means both the Korean internet phrase "God Life" and the reinterpretation "Got 生." (source: 00_inbox/raw-chat-export.md; status: unknown; tags: capture, chat-export, context-engineering)
- GotSaeng OS is a human-in-the-loop context operating system. (source: 01_projects/gotsaeng-os.md; status: unknown; tags: context-engineering, llm, open-source)
- GotSaeng OS is a local-first context compiler. (source: 01_projects/gotsaeng-os.md; status: unknown; tags: context-engineering, llm, open-source)
- GotSaeng OS is not an AI note app. (source: 01_projects/gotsaeng-os.md; status: unknown; tags: context-engineering, llm, open-source)
- The Obsidian plugin is an adapter for v0.2+, not the v0.1 core. (source: 02_decisions/2026-06-06-plugin-vs-framework.md; status: unknown; tags: architecture, framework, obsidian)
- The first compiler should produce PROJECT_CONTEXT.md, MEMORY_SNAPSHOT.md, and decision/action/risk/question outputs. (source: 03_logs/weekly-review-2026-W23.md; status: unknown; tags: stale-demo, weekly-review)
- Model-ready context packs should include source paths so humans can audit claims. (source: 04_research/llm-context-engineering.md; status: unknown; tags: context-engineering, llm, research)

## Key Decisions

### 01_projects/gotsaeng-os.md

- Build the CLI before the Obsidian plugin. (source: 01_projects/gotsaeng-os.md; status: unknown; tags: context-engineering, llm, open-source)
- Treat Obsidian as the first adapter, not the core product. (source: 01_projects/gotsaeng-os.md; status: unknown; tags: context-engineering, llm, open-source)

### 02_decisions/2026-06-06-plugin-vs-framework.md

- GotSaeng OS should be framework-first and plugin-second. (source: 02_decisions/2026-06-06-plugin-vs-framework.md; status: unknown; tags: architecture, framework, obsidian)
- The compiler belongs in packages/core so future adapters do not own the product. (source: 02_decisions/2026-06-06-plugin-vs-framework.md; status: unknown; tags: architecture, framework, obsidian)

## Active Actions

- Convert scattered founder notes into explicit context markers. (source: 00_inbox/raw-chat-export.md; status: active; priority: high; tags: capture, chat-export, context-engineering)
- Add snapshot-quality exporter tests. (source: 01_projects/gotsaeng-os.md; status: open; priority: high; tags: context-engineering, llm, open-source)
- Keep plugin work limited to roadmap documentation for now. (source: 02_decisions/2026-06-06-plugin-vs-framework.md; status: active; priority: medium; tags: architecture, framework, obsidian)
- Document future memory diff and source provenance scoring. (source: 04_research/llm-context-engineering.md; status: open; priority: low; tags: context-engineering, llm, research)
- Revisit old weekly-review actions before publishing v0.1. (source: 03_logs/weekly-review-2026-W23.md; status: open; tags: stale-demo, weekly-review)

## Risks

### 01_projects/gotsaeng-os.md

- A generic productivity dashboard could dilute the compiler-first identity. (source: 01_projects/gotsaeng-os.md; status: unknown; tags: context-engineering, llm, open-source)

### 02_decisions/2026-06-06-plugin-vs-framework.md

- Building the plugin first could trap the architecture inside Obsidian assumptions. (source: 02_decisions/2026-06-06-plugin-vs-framework.md; status: unknown; tags: architecture, framework, obsidian)

### 03_logs/weekly-review-2026-W23.md

- Old open actions can stay invisible unless stale context is surfaced. (source: 03_logs/weekly-review-2026-W23.md; status: unknown; tags: stale-demo, weekly-review)

### 04_research/llm-context-engineering.md

- Semantic contradiction detection is out of scope for v0.1. (source: 04_research/llm-context-engineering.md; status: unknown; tags: context-engineering, llm, research)

## Open Questions

### 00_inbox/raw-chat-export.md

- Which parts of a chat export should become durable project memory? (source: 00_inbox/raw-chat-export.md; status: unknown; tags: capture, chat-export, context-engineering)

### 01_projects/gotsaeng-os.md

- What is the smallest context pack that feels useful in a real handoff? (source: 01_projects/gotsaeng-os.md; status: unknown; tags: context-engineering, llm, open-source)

### 03_logs/weekly-review-2026-W23.md

- Which stale items are still relevant after the compiler lands? (source: 03_logs/weekly-review-2026-W23.md; status: unknown; tags: stale-demo, weekly-review)

### 04_research/llm-context-engineering.md

- Should future context packs include confidence metadata? (source: 04_research/llm-context-engineering.md; status: unknown; tags: context-engineering, llm, research)

## Source Notes

- 00_inbox/raw-chat-export.md (chat-export; title: Raw Chat Export Notes)
- 01_projects/gotsaeng-os.md (project; title: GotSaeng OS)
- 02_decisions/2026-06-06-plugin-vs-framework.md (decision; title: CLI Framework Before Obsidian Plugin)
- 03_logs/weekly-review-2026-W23.md (weekly-review; title: Weekly Review 2026-W23)
- 04_research/llm-context-engineering.md (research; title: LLM Context Engineering Notes)
- templates/decision.md (template; title: Decision Note Template)
- templates/project.md (template; title: Project Note Template)
- templates/weekly-review.md (template; title: Weekly Review Template)
