# Contributing to Jackdaw

Thanks for poking at the source. Jackdaw is small, opinionated, and developed incrementally; before you sink time into a change, skim the design spec and the workflow doc to get a feel for the constraints.

## Prerequisites

- Node.js 20+ and npm.
- An Obsidian vault you're willing to test against. A throwaway vault is recommended.
- A small dedicated GitHub repo for sync testing. Don't point Jackdaw at your real notes repo while iterating.

## Build

```sh
git clone https://github.com/jimcasey/jackdaw.git
cd jackdaw
npm install
npm run build      # production build → main.js
npm run dev        # watch mode (rebuilds on save)
npm run typecheck  # TypeScript type check without emitting
npm run lint       # ESLint over src/
npm test           # unit tests (vitest)
```

## Loading in Obsidian

1. Symlink (or copy) the repo into your vault's plugins folder:
   ```sh
   ln -s /path/to/jackdaw <your-vault>/.obsidian/plugins/jackdaw
   ```
2. Run `npm install && npm run build` to produce `main.js`.
3. In Obsidian → Settings → Community plugins, disable Safe mode and enable **Jackdaw**.
4. While developing, run `npm run dev` for watch mode and use **Reload app without saving** (Ctrl/Cmd+P) after each rebuild.

For end-user install instructions (BRAT), see the [README](README.md).

## Project structure

The authoritative source for architecture is [`docs/design-specification.md`](docs/design-specification.md). Module-by-module notes live in [`CLAUDE.md`](CLAUDE.md). Skim both before touching `src/sync-engine.ts` or anything in `src/ui/modals/`.

Tests live in `tests/` (not `src/`). Unit tests cover the classifier matrix (every cell of §5.5), hash utilities, state store atomicity, and GitHub client error paths.

## Workflow

The full development workflow — branch strategy, issue tracking, planning sessions, AI code review, ADRs — is documented in [`docs/workflow.md`](docs/workflow.md). The short version:

- One issue per branch. Branches are named `claude/<slug>`. All PRs squash-merge into `main`.
- Every PR description must include `Closes #N` (or `Fixes #N`) so the linked issue auto-closes on merge.
- CI must pass (typecheck, lint, unit tests) before merge.
- Significant architectural decisions get an ADR in `docs/adr/`.

## Manual testing

`docs/testing.md` walks through the desktop and iOS smoke-test scenarios. iOS testing on a physical device is the single most important derisking step before any release.

## Reporting issues

File issues against [`jimcasey/jackdaw`](https://github.com/jimcasey/jackdaw/issues). Include:

- Obsidian version and platform (desktop OS / iOS).
- A redacted copy of the relevant `sync.log` entries (the log scrubs the PAT automatically; double-check before pasting).
- Steps to reproduce, ideally against a fresh test repo.
