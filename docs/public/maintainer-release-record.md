# Historical Maintainer Release Record — GotSaeng OS

> **This records the `0.10.0` release.** This is an immutable historical record, not a current-state
> document or a template to edit in place — the version numbers below are deliberately left as they
> were. The project has since shipped through `0.11.0`. For a new release, copy this file's
> structure into a fresh record rather than editing this one.

Date: 2026-06-10

## Release Surface

- GitHub repository: https://github.com/wonkwonlee/gotsaeng-os
- npm package: `@gotsaeng/core@0.10.0`
- npm package: `@gotsaeng/cli@0.10.0`
- Obsidian adapter: private/local distribution for v0.10

## Verification

Completed before publication:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
pnpm smoke:release
pnpm audit --prod
```

Completed after publication:

```bash
npm view @gotsaeng/core version
npm view @gotsaeng/cli version
npm install @gotsaeng/cli
./node_modules/.bin/gotsaeng doctor
```

## Published Package Order

1. `@gotsaeng/core`
2. `@gotsaeng/cli`

`@gotsaeng/shared` was not published because v0.10 public runtime packages do not require it.

## Notes

- npm 2FA browser authentication was required during publish.
- Initial `npm view` 404 resolved after registry propagation.
- The final registry state reported both packages at `0.10.0`.
- A clean `git archive HEAD` snapshot was used for the first public repository push.
