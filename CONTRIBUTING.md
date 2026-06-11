# Contributing

Thanks for helping build GotSaeng OS.

## Development

Use pnpm and Node.js 20 or newer.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

## Scope

GotSaeng OS v0.10 is a local-first, compiler-first Markdown context compiler. Contributions should
preserve the current local-only release boundary: no cloud sync, telemetry, credential collection,
hidden network calls, LLM API calls, or broad productivity-app features unless a future roadmap item
explicitly opens that scope.

## Architecture Boundaries

- Put compiler behavior in `packages/core`.
- Put CLI command parsing, console output, exit codes, and user-facing terminal errors in
  `packages/cli`.
- Put Obsidian adapter shell behavior in `apps/obsidian-plugin` and delegate compilation to
  `packages/core` instead of reimplementing compiler logic.

---

## Repo Map

```
gotsaeng-os/
├── packages/
│   ├── core/                          # All compiler logic — start here
│   │   └── src/
│   │       ├── compiler.ts            # Entry point: compileContextPack() + writeContextPack()
│   │       ├── scanner.ts             # Glob vault files (scanMarkdownFiles, scanSourceFiles)
│   │       ├── parser.ts              # Markdown → NoteDocument (parseMarkdown, parseMarkdownFile)
│   │       ├── classifier.ts          # Path/frontmatter → NoteType (classifyNoteType, mapCompatibleNoteType)
│   │       ├── extractor.ts           # Lines → ExtractedItem[] (extractItems, MARKER_TO_KIND)
│   │       ├── confidence.ts          # Per-item confidence scoring (scoreExtractionConfidence)
│   │       ├── provenance.ts          # Source provenance scoring (applySourceProvenance)
│   │       ├── contradictions.ts      # Contradiction candidate detection
│   │       ├── stale.ts               # Stale item detection
│   │       ├── memory-diff.ts         # Context manifest + cross-run diff
│   │       ├── quality.ts             # Warning triage (createWarningTriage)
│   │       ├── report.ts              # Compile report assembly
│   │       ├── schemas/
│   │       │   ├── note.ts            # NoteType enum + NoteDocument Zod schema
│   │       │   ├── context.ts         # ExtractedItemKind enum + all context Zod schemas
│   │       │   └── config.ts          # CompileOptions Zod schema
│   │       ├── exporters/
│   │       │   ├── markdown-exporter.ts  # Write context pack as Markdown files
│   │       │   └── json-exporter.ts      # Write COMPILE_REPORT.json
│   │       └── utils/
│   │           ├── date.ts            # Date normalization helpers
│   │           ├── hash.ts            # Deterministic ID generation
│   │           └── path.ts            # Path normalization + sorting helpers
│   │   └── test/                      # Vitest unit tests (one file per src module)
│   ├── cli/                           # CLI command parsing, output, exit codes
│   │   └── src/
│   │       └── commands/compile.ts    # `compile` command (requires --output, --project)
│   └── shared/                        # Private shared utilities (not published)
├── apps/
│   └── obsidian-plugin/               # Obsidian adapter; delegates to packages/core
└── examples/
    ├── sample-vault/                  # Example vault for smoke tests and demos
    └── sample-output/                 # Pre-generated output from sample-vault
```

**Data flow:**
```
vault/ (Markdown files)
  → scanner.ts       (glob → file paths)
  → parser.ts        (raw Markdown → NoteDocument)
  → classifier.ts    (frontmatter/path → NoteType, called inside parser)
  → extractor.ts     (NoteDocument → ExtractedItem[])
  → confidence.ts    (score each item)
  → provenance.ts    (score each source note)
  → contradictions.ts, stale.ts  (cross-note analysis)
  → compiler.ts      (assemble ContextPack, write output via exporters)
```

---

## Walkthroughs

### How to add a new extraction marker

Extraction markers are keywords you can write in vault notes to explicitly tag a line. Example:

```markdown
- fact: GotSaeng OS is local-first.
- 사실: GotSaeng OS는 로컬 우선입니다.
```

**Step 1 — Pick a kind.** Markers map to one of the seven `ExtractedItemKind` values defined in
`packages/core/src/schemas/context.ts`:

```
fact | decision | action | risk | assumption | question | insight
```

If your new concept fits one of these, add an alias (step 2). If it genuinely requires a new kind,
see "How to add a new note type" below for the pattern — but new kinds need stronger justification
because they affect the ContextPack schema and all downstream consumers.

**Step 2 — Register the marker alias** in `MARKER_TO_KIND` at the top of
`packages/core/src/extractor.ts`:

```ts
// packages/core/src/extractor.ts
const MARKER_TO_KIND: Record<string, ExtractedItemKind> = {
  // ... existing entries ...
  blocker: "risk",    // ← your new alias
  블로커: "risk",     // ← Korean alias if applicable
};
```

The key must be lowercase. The regex that matches it is case-insensitive, so `Blocker:` and
`BLOCKER:` will both match at runtime. The value must be one of the `ExtractedItemKind` values.

**Step 3 — Add tests** in `packages/core/test/extractor.test.ts`. Follow the existing pattern:

```ts
it("maps 'blocker' marker to risk kind", () => {
  const note = parseMarkdown(
    "- blocker: No deployment pipeline yet.",
    "/vault/note.md",
    "/vault"
  );
  expect(extractItems(note)).toMatchObject([{ kind: "risk", text: "No deployment pipeline yet." }]);
});
```

**Step 4 — Run the quality gates** (see checklist below). No other files need to change for a
pure alias addition.

---

### How to add a new note type

Note types are assigned to each `NoteDocument` and influence extraction confidence scoring and
inferred-extraction eligibility.

**Canonical note types** are the `NoteTypeSchema` enum in `packages/core/src/schemas/note.ts`:

```
project | decision | daily | weekly-review | research | chat-export | template | unknown
```

**Step 1 — Add the new type to the enum** in `packages/core/src/schemas/note.ts`:

```ts
export const NoteTypeSchema = z.enum([
  "project",
  "decision",
  "daily",
  "weekly-review",
  "research",
  "chat-export",
  "template",
  "meeting",   // ← your new type
  "unknown"
]);
```

This is a breaking schema change. Verify that no existing snapshot tests break before continuing.

**Step 2 — Add classification logic** in `packages/core/src/classifier.ts`. Choose the right
place:

- **Path-based heuristic** (no frontmatter needed): add an `if` block inside `classifyNoteType`
  that matches on `normalizedPath`:

  ```ts
  if (normalizedPath.includes("meetings") || normalizedPath.includes("interviews")) {
    return "meeting";
  }
  ```

- **Frontmatter alias** (for vaults that use `type: meeting` in YAML): add an entry to the
  `aliases` record in `mapCompatibleNoteType`:

  ```ts
  const aliases: Record<string, NoteType> = {
    // ... existing entries ...
    meeting: "meeting",
  };
  ```

**Step 3 — Update inferred-extraction eligibility** in `packages/core/src/extractor.ts`. The
`shouldUseInferredExtraction` function skips templates, archived notes, and system files. If your
new type should also be skipped (e.g., it is read-only metadata), add a condition:

```ts
function shouldUseInferredExtraction(note: NoteDocument): boolean {
  if (note.noteType === "template" || note.noteType === "meeting") {
    return false;   // ← opt out if inferred extraction doesn't apply
  }
  // ... rest of function ...
}
```

**Step 4 — Update confidence scoring** in `packages/core/src/confidence.ts` if the new type
should receive a different impact value. Currently all non-template, non-unknown types get `+10`.
Add an explicit branch if the new type warrants a different treatment.

**Step 5 — Add tests** in:
- `packages/core/test/classifier.test.ts` — test both path-based and frontmatter-based detection
- `packages/core/test/extractor.test.ts` — if inferred extraction behavior changes

**Step 6 — Run the quality gates.**

---

## Quality-Gate Checklist

Run all four commands before requesting review. All must pass:

```bash
pnpm typecheck   # strict TypeScript — zero errors required
pnpm test        # Vitest unit tests
pnpm build       # tsup build for all packages
pnpm lint        # ESLint
```

Specific things to check before each PR:

- [ ] `pnpm typecheck` exits 0 with no errors.
- [ ] `pnpm test` exits 0 — no skipped tests introduced to make the suite pass.
- [ ] `pnpm build` exits 0 — dist artifacts generated cleanly.
- [ ] `pnpm lint` exits 0 — no lint suppressions added without comment.
- [ ] New behavior is covered by at least one unit test in the relevant `test/` file.
- [ ] Public-API changes (schemas, exported functions) have updated `packages/core/src/index.ts`
  exports if needed.
- [ ] No new runtime dependencies introduced. Dev-only dependencies require a brief justification
  in the PR description.
- [ ] No telemetry, cloud calls, network calls, or LLM API calls added.
- [ ] Docs updated if public CLI behavior changed (root `README.md` or `packages/cli/README.md`).

---

## Pull Requests

- Keep changes focused and reviewable.
- Add or update tests for behavior changes.
- Update docs when public behavior changes.
- Explain security or privacy implications when relevant.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm lint` before requesting review.
