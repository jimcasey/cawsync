# Development Workflow

## Overview

Jackdaw is developed incrementally through Claude Code. Claude handles implementation and plays product/design roles during planning. The human approves at every gate.

See `docs/human-interactions.md` for every point that requires human input.

---

## Branch strategy

| Branch | Purpose |
|---|---|
| `main` | Always releasable. Nothing merges without a PR. |
| `claude/<slug>` | All work branches. One issue per branch. Short-lived. |

All PRs are **squash-merged** into `main`. This keeps history readable and one-to-one with issues.

---

## Issue tracking

GitHub Issues + Milestones. No Projects board.

### Labels

| Label | Meaning |
|---|---|
| `type: feature` | New capability |
| `type: bug` | Something broken |
| `type: chore` | Scaffolding, tooling, CI |
| `type: docs` | Documentation only |
| `phase: 0` … `phase: 5` | Which build phase |
| `needs: planning` | Requires a planning session before work starts |
| `needs: review` | AI review requested |

### Milestones

| Milestone | Contents |
|---|---|
| Phase 0 — Scaffold | npm project, build config, `manifest.json`, stub `main.ts`, CI |
| Phase 1 — Core libs | `github-client.ts`, `state-store.ts`, `logger.ts` |
| Phase 2 — Sync engine | `sync-engine.ts`, classifier, pull, push |
| Phase 3 — UI | Settings tab, ribbon, status bar, error notices |
| Phase 4 — First-sync + conflicts | First-sync modal, conflict resolution modal |
| Phase 5 — BRAT release | Tests, iOS validation, Obsidian Sync coexistence, README, release |

**Rule:** Only populate issues for the current phase and the next one. Don't create issues for phases beyond that — the spec will have evolved by then.

---

## Planning sessions

Before each phase (or when an issue is labeled `needs: planning`), run a planning session where Claude plays two roles:

- **Product**: Does this feature serve the primary use case (§1.3 of the spec)? Is the scope right? What's the acceptance criterion?
- **Design**: How does this present to the user? What are the edge-case UX states (loading, error, conflict)? Does it work on a phone screen?

**Output of a planning session:**
1. A set of GitHub Issues with descriptions and acceptance criteria.
2. A session summary saved to `docs/sessions/YYYY-MM-DD-<topic>.md`.

Planning sessions are triggered when:
- Starting a new phase
- An issue is labeled `needs: planning`
- A design decision in the spec needs to be resolved before coding

---

## Development loop (per issue)

```
Planning session → GitHub Issues created
        ↓
Pick an issue
        ↓
Claude Code: implement on claude/<slug> branch
        ↓
PR opened (title references issue; body closes #N)
        ↓
/review runs (Claude posts findings as a PR comment)
        ↓
Human reviews findings + approves
        ↓
Squash merge → issue closes automatically
```

For UI-facing changes, the planning session also doubles as a design review: Claude proposes the UX flow before any code is written.

---

## AI code review

Run `/review` on every PR before merging. `/review` performs a focused branch review and posts findings as a PR comment for human sign-off.

Invoke with phase-specific guidance so the review targets the right concerns:

| Phase | Review focus |
|---|---|
| 0–1 | Correctness, constraint compliance (`requestUrl` not `fetch`, vault I/O only, PAT never logged) |
| 2 | Classifier matrix coverage (every cell of §5.5), error handling, retry logic |
| 3+ | Mobile layout, iOS-specific behavior, accessibility |

Example invocation for Phase 2: `/review` — then note in the PR comment prompt to check classifier matrix coverage and retry logic against §5.5 of the design spec.

---

## CI

GitHub Actions runs lint and type-check on every PR and on pushes to `main`. Configuration lives at `.github/workflows/ci.yml`. The specific npm scripts (`typecheck`, `lint`) are wired up in Phase 0.

CI must pass before a PR can be merged.

---

## ADRs

Significant architectural or product decisions get a record in `docs/adr/NNN-<slug>.md`.

- Claude drafts the ADR during the planning session or at decision time.
- Human approves via PR review.
- Merged ADRs are **immutable** — new decisions supersede rather than edit.

Template: see `docs/adr/001-mit-license.md`.

---

## Phase summary

```
Phase 0  Scaffold          npm, build, manifest.json, stub main.ts, CI
Phase 1  Core libs         github-client.ts, state-store.ts, logger.ts
Phase 2  Sync engine       classifier, pull, push
Phase 3  UI                settings tab, ribbon, status bar
Phase 4  First-sync+conf   first-sync modal, conflict resolution modal
Phase 5  BRAT release      tests, iOS, Obsidian Sync coexistence, README, ship
```

---

Authoritative spec: `docs/design-specification.md`
