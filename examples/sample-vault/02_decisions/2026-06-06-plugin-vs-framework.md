---
type: decision
title: CLI Framework Before Obsidian Plugin
created: 2026-06-06
updated: 2026-06-06
tags:
  - architecture
  - obsidian
  - framework
---

# CLI Framework Before Obsidian Plugin

Decision: GotSaeng OS should be framework-first and plugin-second.

## Rationale

- decision: The compiler belongs in packages/core so future adapters do not own the product.
- fact: The Obsidian plugin is an adapter for v0.2+, not the v0.1 core.
- action: Keep plugin work limited to roadmap documentation for now. status: active priority: medium
- risk: Building the plugin first could trap the architecture inside Obsidian assumptions.
- assumption: A CLI-first foundation is easier to test and publish as open-source infrastructure.
- insight: A boring compiler is a stronger base than a flashy integration.
