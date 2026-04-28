# Human Interactions

Every point in the development workflow that requires a human decision or action.

---

## Initial setup

**Trigger:** This document is first created.

**Action:** In GitHub repository settings, create the following milestones and configure label colors:

Milestones to create (no due dates required):
- `Phase 0 — Scaffold`
- `Phase 1 — Core libs`
- `Phase 2 — Sync engine`
- `Phase 3 — UI`
- `Phase 4 — First-sync + conflicts`
- `Phase 5 — BRAT release`

Labels to configure (colors are suggestions):
- `type: feature` — blue (`#0075ca`)
- `type: bug` — red (`#d73a4a`)
- `type: chore` — gray (`#e4e669`)
- `type: docs` — light gray (`#cfd3d7`)
- `phase: 0` through `phase: 5` — yellow gradient
- `needs: planning` — purple (`#7057ff`)
- `needs: review` — orange (`#e99695`)

Assign existing issues to the Phase 0 milestone and apply appropriate labels.

---

## Phase planning

**Trigger:** Start of each phase, or an issue is labeled `needs: planning`.

**Action:**
1. Start a Claude Code session and request a planning session for the phase.
2. Read the session summary saved to `docs/sessions/`.
3. Review each created issue: title, description, acceptance criteria.
4. Edit, close, or add issues as needed.
5. Assign the correct phase label and milestone to each issue.
6. Signal readiness — work does not start until you confirm issues are ready.

---

## ADR review

**Trigger:** Claude opens a PR containing a new `docs/adr/NNN-<slug>.md`.

**Action:** Read the ADR. Approve if the decision is correct; request changes or reopen discussion if not. Merged ADRs are immutable — if you have doubts, surface them before merging.

---

## Pull request review

**Trigger:** Implementation is complete on a branch. `/ultrareview` has run.

**Action:**
1. Read the `/ultrareview` output.
2. Review the diff.
3. Approve and squash-merge, or request changes.

Do not merge without `/ultrareview` completing. If ultrareview raises a concern you're unsure about, ask Claude to explain before merging.

---

## Phase gate

**Trigger:** All issues in a phase milestone are closed.

**Action:** Confirm the phase is done before planning the next one. For Phase 2 and later, smoke-test the plugin in Obsidian desktop before sign-off. Sign-off is explicit ("start Phase N planning") — phases do not advance automatically.

---

## iOS manual testing (Phase 5 gate)

**Trigger:** Phase 5 milestone begins.

**Action:** Execute every scenario in §11.3 of `docs/design-specification.md` on a **physical iPhone**. This cannot be delegated to Claude or automated.

Scenarios (§11.3):
- Install via BRAT; first-sync against a real (small) test vault and test repo
- Sync after editing on iOS only (push-only path)
- Sync after editing remotely only (pull-only path)
- Sync with a conflict; resolve via mobile UI
- Force-quit Obsidian mid-sync; reopen; verify state recovery via `.tmp` path
- Upload a 25 MB attachment; verify size-limit message appears
- Toggle airplane mode mid-sync; verify failure mode and message

Record pass/fail for each scenario. Phase 5 does not close until all pass.

---

## Obsidian Sync coexistence testing (Phase 5 gate)

**Trigger:** iOS manual testing complete.

**Action:** Execute every scenario in §11.4 using two real devices both running Obsidian Sync and the plugin:

- Edit on device A → sync to GitHub from A → wait for Obsidian Sync to propagate → sync from B → expect no-op, no conflict
- Edit on device A → sync from A → sync from B *before* Obsidian Sync propagates (stale `sync-state.json` on B) → expect staleness detection (§4.4 case 3) and silent recovery
- Edit on both devices + agent edit on GitHub → sync from one device → verify conflict UI shows the right conflicts and resolution applies cleanly

---

## BRAT release

**Trigger:** All Phase 5 acceptance criteria (§15 of `docs/design-specification.md`) are met.

**Action:**
1. Create a GitHub Release with a semver tag — e.g., `0.1.0`. No `v` prefix (required by the Obsidian registry, future-proofing now).
2. Attach build artifacts (`main.js`, `manifest.json`, `styles.css` if present).
3. Post to the Obsidian community forum and/or Discord to recruit BRAT testers.

---

## Community registry submission (v1.1, future)

**Trigger:** Two consecutive weeks with no high-severity bug reports after BRAT release, and all registry prerequisites from §14 of the design spec are met.

**Action:**
1. Submit a PR to the [obsidian-releases](https://github.com/obsidianmd/obsidian-releases) repository.
2. Monitor review; respond to feedback.
3. See §14 of `docs/design-specification.md` for constraints (no "obsidian" in ID, no version `v` prefix, README requirements).
