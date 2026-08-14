---
name: address-pr-review
description: Use when the user asks to address, respond to, resolve, or fix PR review comments (e.g. from the chatgpt-codex-connector bot or a human reviewer) on an open GitHub pull request in this repo. Triggers on phrases like "PR 리뷰 코멘트들에 대응해라", "respond to the review comments", "fix the Codex feedback", "address the PR feedback".
user-invocable: true
argument-hint: "[PR number]"
---

# Address PR Review Comments

Fixing the code without replying to the reviewer is an incomplete response, and replying without
fixing the code is worse. Both halves are required every time this skill runs.

Only run this on a PR whose source you trust (the repo owner, an approved collaborator, or a fork
you've already reviewed) — step 5 runs this repo's own `pnpm install`/build/test scripts, and step
6 pushes a commit. A malicious fork PR could otherwise get its untrusted code executed and, if
review comments steer the fix, have unreviewed changes pushed under the maintainer's identity.

## Steps

1. **Identify the target PR(s).** If a PR number was given as an argument, use it. Otherwise ask,
   or if the user clearly means "whatever's open", list open PRs:

   ```bash
   gh pr list --state open --json number,headRefName,title
   ```

2. **Fetch every review comment**, not just the top-level review body:

   ```bash
   gh api repos/<owner>/<repo>/pulls/<n>/comments
   gh api repos/<owner>/<repo>/pulls/<n>/reviews
   ```

   Each inline comment has an `id` (needed for the reply step) and a `body` — bot reviews here
   (`chatgpt-codex-connector[bot]`) prefix each with a `P1`/`P2` severity badge. Read every one; do
   not stop at the first review object — a PR can have multiple review passes with distinct
   comment sets.

3. **Check out the PR's branch with `gh pr checkout <n>`** — never `git checkout <headRefName>` or
   a hand-built `git fetch`/`git checkout` pair. For a fork PR, `headRefName` is attacker-controlled
   and not globally unique (a fork can name its branch `main`, or anything else that collides with
   a branch you already have); it can also contain shell metacharacters. `gh pr checkout` resolves
   the PR by its immutable number via the API and creates a disambiguated local branch itself, so
   nothing here builds a git command out of untrusted ref-name text. Confirm the working tree is
   clean first (`git status --short --branch`).

4. **Fix the actual defect for each comment**, not just the symptom the reviewer described:
   - Read the surrounding code before editing; a comment about one line often implies a fix that
     needs to touch a caller, a test fixture, or a doc claim elsewhere too.
   - When a fix changes behavior that existing tests encode as correct (e.g. a safety check now
     requires a marker that test fixtures didn't include), update those tests to match the new,
     safer behavior — don't weaken the fix to keep old tests green.
   - Add a regression test for anything security- or correctness-flagged (P1, or any comment
     describing data loss / unhandled rejection / incorrect claim), proving the described failure
     scenario no longer reproduces.
   - Low-severity doc/wording comments (P2 "the README overstates X") still need the doc text
     corrected — don't downgrade real inaccuracies to "won't fix" without asking the user first.

5. **Run the full local quality gate** before committing (see this repo's CLAUDE.md Quality Gates
   section — currently `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm
format:check && pnpm check:versions`). If a gate can't run, say why instead of skipping
   silently.

6. **Commit and push** to the PR's branch. One commit covering the whole review pass is fine;
   write a commit message that explains _why_ each fix was needed (the failure scenario), not just
   what changed — reviewers on the GitHub thread will read the commit hash you cite in step 7.

7. **Reply to every individual comment thread**, referencing the commit hash:

   ```bash
   gh api repos/<owner>/<repo>/pulls/comments/<comment_id>/replies -f body="Fixed in <hash>. <what changed and why>."
   ```

   One reply per comment `id` gathered in step 2 — never bundle multiple review points into a
   single top-level PR comment instead. If a comment is being intentionally not addressed (out of
   scope, disagreement with the suggestion), say so explicitly in the reply rather than going
   silent.

8. **Report back concisely**: which PR(s), what changed, gate results, and confirmation that every
   comment thread got a reply.

## Notes

- This repo's dev branch may be checked out in a different git worktree than the one this session
  is running in (`git worktree list` to check) — `git checkout main` failing with "already used by
  worktree" is expected in that case, not a repo problem.
- Never merge the PR as part of this skill unless the user explicitly asks — fixing and replying
  is the scope; merging is a separate, higher-stakes action.
