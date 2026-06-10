---
type: project
title: GotSaeng OS
status: active
domain: ai-infra
priority: high
created: 2026-06-06
updated: 2026-06-06
tags:
  - llm
  - context-engineering
  - open-source
---

# GotSaeng OS

GotSaeng OS 生

Reclaim your scattered life.

흩어진 생을 다시 손에 쥐다.

GotSaeng OS is an open-source context engineering framework for compiling Markdown notes,
chat logs, decisions, and execution records into model-ready memory snapshots.

## Current Objective

Ship the v0.1 local-first context compiler as a credible open-source foundation.

## Positioning

- fact: GotSaeng OS is not an AI note app.
- fact: GotSaeng OS is a human-in-the-loop context operating system.
- fact: GotSaeng OS is a local-first context compiler.
- decision: Build the CLI before the Obsidian plugin.
- decision: Treat Obsidian as the first adapter, not the core product.
- action: Implement the Markdown scanner and parser. status: done
- [ ] action: Add snapshot-quality exporter tests. priority: high
- risk: A generic productivity dashboard could dilute the compiler-first identity.
- assumption: Early users are likely to be Obsidian power users and technical builders.
- question: What is the smallest context pack that feels useful in a real handoff?
- insight: The real product is portable context infrastructure, not a note app.
- insight: ADHD-aware workflows can help anyone managing fragmented attention and long-running goals.
