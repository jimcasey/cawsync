# Phase 5 Planning — BRAT release

**Date:** 2026-04-30
**Milestone:** Phase 5 — BRAT release
**Modules in scope:** integration test harness (new), CI workflow updates, README rewrite, user docs, mobile diff fix (#112), `manifest.json` / `versions.json` / GitHub Release infrastructure, design-spec amendments, manual gate execution

---

## Goal

Ship a v1.0.0 release that BRAT users can install on Obsidian desktop and iOS. Phase 4 closed all the code paths the engine and modals need; Phase 5 is the gate phase — every acceptance criterion in §15, every iOS scenario in §11.3, every Obsidian Sync scenario in §11.4 must be verified before tagging the release. The new code in this phase is concentrated in (a) integration tests against real GitHub, (b) the mobile diff bug from #112 that blocks the iOS conflict scenario, (c) docs.

No engine, classifier, GitHub-client, or modal architectural changes are anticipated. Bug fixes uncovered by integration or manual testing are expected and welcome.

---

## Decisions

### v1.0.0 is the BRAT release tag

§15 of the spec is titled *"Acceptance criteria for v1.0 (BRAT release)"*. The first BRAT-published version will be tagged `1.0.0`, matching the spec's framing. `manifest.json` (currently `0.0.1`) and `package.json` (currently `0.1.0`) get bumped to `1.0.0` as part of the release prep PR. Per §14, the GitHub release tag must match `manifest.json` exactly with no `v` prefix — i.e. tag `1.0.0`, not `v1.0.0` — so the registry submission later doesn't require a re-tag.

Subsequent BRAT iterations are `1.0.1`, `1.1.0`, etc. The registry-submission milestone (deferred per §12 / §14) starts when §14's four "submit after" gates are satisfied.

### Integration tests run against a dedicated CI sandbox repo

§11.2 requires real-GitHub integration tests with a fresh branch per run. Two open questions: which repo, and where do the tests run.

**Repo choice: a dedicated sandbox repo on the same account, e.g. `jimcasey/jackdaw-ci-sandbox`.** Rationale: keeping the test repo *separate from* the plugin repo means PR CI on `jackdaw` itself can never accidentally clobber test branches, and the sandbox can be reset / pruned independently. The repo holds one long-lived seed branch (`main`) with a small fixture commit; every test creates a fresh branch off that seed and deletes it on teardown.

**Where tests run: GitHub Actions, on `push: main` and `workflow_dispatch` only — not on PRs.** PR CI stays hermetic (current `typecheck` / `lint` / `test` jobs only). Integration tests run after merge to `main` and on demand. Reasons: (1) PR runners on forks can't access the secret; (2) flaky network shouldn't block the per-PR review loop; (3) rate-limit budget is precious — the PAT is shared and we don't want two parallel PRs hammering it.

PAT is stored as `INTEGRATION_TEST_GH_TOKEN` in the `jackdaw` repo's Actions secrets. Scope: fine-grained, repo-bound to the sandbox repo only, `Contents: read & write`, expires 90 days. Rotation is a docs note, not automated.

**Test harness: a second Vitest config (`vitest.integration.config.ts`) over `tests/integration/*.test.ts`,** invoked by `npm run test:integration`. Tests instantiate a real `GitHubClient` against the sandbox, real `SyncEngine`, and in-memory test doubles for `VaultAdapter` + `StateAdapter`. The unit-test config explicitly excludes `tests/integration/` so the existing `npm test` stays hermetic and fast.

### Integration test scenarios mirror §11.2 plus the §15 perf gates

Per §11.2:

- First-sync, empty repo + non-empty vault.
- First-sync, non-empty repo + empty vault.
- First-sync, both populated, including conflicts.
- Round-trip: change locally → sync → change remotely via API → sync.
- Concurrent-device race: two engine instances, expect retry.
- Tree truncation path: synthetic vault > 1k files (don't go for 100k).
- Per-file size-limit enforcement.

Per §15 acceptance:

- 1,000-file no-op sync completes under 30 s.
- Same vault with 10 changed files completes under 60 s.

The two perf scenarios fold into the integration suite as timed assertions. They run on the GitHub Actions Linux runner; we accept that runner-to-runner variance may push numbers around but expect comfortable headroom under both thresholds in practice.

### Force-quit recovery is asserted via state-store unit tests, not integration

§15 requires "Force-quit during any phase of sync leaves the vault in a recoverable state." The recovery mechanism is `StateStore.load()` recovering from `.tmp` when the canonical file is missing — already covered by `tests/state-store.test.ts`. Phase 5 adds (a) one integration assertion that a deliberately-aborted sync mid-push leaves no orphaned `.tmp` after a subsequent successful sync, and (b) a §11.3 manual scenario that exercises real Obsidian force-quit on iOS.

### Manual gates are tracked as a single checklist issue, not split per scenario

§11.3 has 7 iOS scenarios; §11.4 has 3 coexistence scenarios; the Phase 4 retro flagged 4 desktop end-to-end smokes that were deferred. That's 14 manual checks. Splitting them across 14 issues is bookkeeping noise; consolidating them into one Phase 5 acceptance issue with a checklist body keeps the gate visible and lets us record pass/fail evidence in PR comments as we go.

### Issue #112 (mobile diff wrapping) is in scope and re-labeled `phase: 5`

#112 is currently `phase: 4` but blocks the §11.3 scenario *"Edit the same file both locally and on GitHub, then sync from iOS — Conflict UI appears; resolving with either option applies cleanly."* Without the fix, conflict resolution on iOS forces horizontal scroll on every long line. We re-label as `phase: 5` and ship the `ResizeObserver` plumbing described in the issue body. This is the only behavior change to Phase 4 modal code in Phase 5.

### README is rewritten for BRAT consumers; user-guide is separate

Today's README is dev-focused (`git clone`, `npm install`). For a BRAT release we need an end-user surface that satisfies the §15 disclosure list:

- iOS-only mobile support (Android explicitly unsupported in v1).
- BRAT installation steps.
- PAT-on-every-device implication when using Obsidian Sync.
- Manual-only sync model (no autosync).
- No branching/merging — single configured branch.

Plan: README becomes the BRAT discoverability surface (overview → install via BRAT → quick configuration → caveats → links). A new `docs/user-guide.md` covers detailed PAT setup, troubleshooting, and the per-feature walkthroughs from issue #89. Dev-focused content (currently in README) moves into a `CONTRIBUTING.md` or stays in `docs/workflow.md` (already linked).

Issue #89 collapses into the user-guide deliverable; the README rewrite is a separate, smaller PR that links to it.

### Screenshots: desktop + iOS, captured manually, committed to `docs/screenshots/`

BRAT users skim README before installing. We need at minimum: (1) settings tab, (2) ribbon icon + status bar mid-sync, (3) conflict resolution modal with one row expanded, (4) first-sync modal with the summary block visible. Captured at 2× retina on macOS and iPhone, downscaled to ~800px wide where appropriate, committed as PNGs under `docs/screenshots/`. README and user-guide reference them via relative paths.

### Release infrastructure: GitHub Actions on tag push, not manual

A new `.github/workflows/release.yml` triggers on `push: tags: ['*.*.*']`. Steps: checkout → `npm ci` → `npm run build` → upload `manifest.json`, `main.js`, `styles.css` as a GitHub Release asset attached to the tag. Release body is auto-populated from a `CHANGELOG.md` (new file, kept simple — Keep-A-Changelog format). BRAT consumes the release assets directly, so no extra `bundle.zip` is needed.

The `versions.json` map (`{ "1.0.0": "1.4.0" }`) is updated by hand in the same PR that bumps `manifest.json` to `1.0.0`. The minimum Obsidian version stays at 1.4.0 until we have evidence we need to lift it.

### Spec amendments deferred from Phase 4 are folded into Phase 5

Three spec edits are queued from the Phase 4 retro:
- §6 — add `GHEmptyRepoError` to the error-class enumeration.
- §8.3 — note that conflict rows are collapsed by default and load on expand.
- §3 — note `ConflictItem` carries `isBinary` / `localSize` / `remoteSize` / `remoteBlobSha` beyond `ClassifiedPath`.

These ship as a single docs PR early in the phase so the spec is current before the README rewrite (which links to it) lands. ADRs are not warranted for any of the three — they're clarifications, not new decisions.

---

## Issues to create

Phase 5 work (`phase: 5`):

| # | Title | Type | Depends on |
|---|---|---|---|
| #113 | Spec amendments: §3, §6, §8.3 (Phase 4 deferrals) | docs | — |
| #112 | Mobile diff wrapping via `ResizeObserver` (re-labeled `phase: 5`) | bug | — |
| #114 | Integration test harness: vitest config, sandbox repo bootstrap, CI job | chore | — |
| #115 | Integration test scenarios: §11.2 coverage + §15 perf gates | feature | #114 |
| #117 | Screenshots: desktop + iOS, committed under `docs/screenshots/` | docs | #112 (for iOS conflict shot) |
| #116 | README rewrite for BRAT consumers (caveats + install + screenshots) | docs | #117 |
| #89 | User guide: PAT setup walkthrough + troubleshooting | docs | — |
| #118 | Release infrastructure: `release.yml`, `CHANGELOG.md`, version bump to 1.0.0 | chore | #116 |
| #119 | Phase 5 acceptance gate: §11.3 + §11.4 + §15 manual checklist | chore | #118 |
| #120 | Phase 5 retrospective | docs | #119 |

#89 is repurposed as the user-guide deliverable (its body has been narrowed — the README rewrite absorbed the install/discoverability scope). #112 is re-labeled `phase: 5` and milestoned into the BRAT release.

### Recommended order

1. **Spec amendments** ship first — small, fast, unblocks the README rewrite.
2. **Mobile diff fix (#112)** — blocks the iOS conflict scenario; ship before the manual gate.
3. **Integration test harness** in parallel with the diff fix.
4. **Integration test scenarios** once the harness is merged.
5. **Screenshots** (manual capture), **README rewrite**, and **user guide** — all docs work, can run in parallel by different PRs.
6. **Release infrastructure** — final PR that bumps versions and adds the release workflow. Lands just before tagging.
7. **Acceptance gate** — manual checklist run against the freshly-tagged 1.0.0 build installed via BRAT on a real iPhone. Findings either close the gate or open follow-up bug issues that themselves block the gate.
8. **Retrospective** — closes the phase.

The acceptance gate is the only sequential bottleneck — every bug it surfaces becomes a Phase 5 issue that has to land before the gate re-runs. Plan for at least one bug-fix iteration after the first manual run.

---

## Open questions deferred

- **Performance test variance on the GitHub Actions Linux runner.** The §15 thresholds (30 s no-op / 60 s with 10 changes) have headroom but runner-to-runner CPU and network variance is real. If the timed assertion flakes, options: (a) loosen the threshold and document the variance, (b) re-run on flake (vitest retry), (c) move perf gates to a self-hosted runner. Decide after observing the first 5-10 CI runs.
- **Concurrent-device race test reliability.** Two engine instances running against the same branch is inherently a race; the assertion is "one succeeds, one retries successfully." Worst case it deadlocks against ref-update contention. We have a 2-retry cap in `SyncEngine`; if the test reliably exhausts retries, that's a real bug to investigate, not a flake to suppress.
- **Sandbox repo cleanup.** Every integration test creates a branch and deletes it on teardown. If a test crashes mid-run, branches leak. A weekly `workflow_dispatch` cleanup job that prunes branches older than 24 h would prevent buildup, but it's not a Phase 5 blocker — manual prune is fine for now.
- **iOS-side state when the modal is open and Obsidian backgrounds the app.** The §11.3 force-quit scenario covers the cold-quit path, but app-backgrounding mid-modal is a softer edge case. Worth a manual probe; not worth a separate scenario unless we see corruption.
- **Should the "Test connection" diagnostic also probe write access?** Today it probes read (`getBranch`). For the BRAT install flow, "PAT is correct *and* has Contents:write" is the actual question. Making it write a tiny probe blob (then delete it) would catch read-only PATs. Defer unless support burden warrants.
- **CHANGELOG.md tone and format.** Keep-A-Changelog with `## [1.0.0] - 2026-MM-DD` headers is the simple default. If we want to auto-generate from PR titles via `release-drafter` or similar, that's a follow-up.
- **`obsidian-` prefix on the plugin name.** §14 notes the registry forbids "obsidian" in the ID and description. `manifest.json` already uses ID `jackdaw` — fine. Description currently reads *"Manual, bidirectional, one-button sync between an Obsidian vault and a GitHub repository branch."* That uses "Obsidian" as a noun referring to the host app, which is the same construction the registry permits in practice (the policy is about plugins claiming the brand, e.g. "Obsidian Sync Pro"). Worth re-reading the registry rules at submission time, not now.

---

## Definition of done for Phase 5

- All Phase 5 issues closed.
- `npm test`, `npm run lint`, `npm run typecheck` pass on `main`.
- `npm run test:integration` passes against the sandbox repo on the most recent `main` commit (recorded in CI history).
- Every §11.3 iOS scenario passes on a physical iPhone running the BRAT-installed 1.0.0 build.
- Every §11.4 Obsidian Sync coexistence scenario passes.
- Every §15 acceptance criterion is verified (perf, force-quit, README content, PAT-never-logged regression).
- A 1.0.0 GitHub Release exists with `manifest.json`, `main.js`, `styles.css` attached.
- A user reading only the README can install Jackdaw via BRAT and complete a first sync without consulting the design spec.

---

## Human gates remaining for Phase 5

Per `docs/workflow.md`:

1. **Phase planning sign-off** — review this summary and confirm the issue list before issues are created.
2. **Per-PR review** — `/review` on each PR with Phase 3+ focus (mobile layout, iOS-specific behavior, accessibility).
3. **Acceptance gate execution** — the §11.3 / §11.4 / §15 checklist must be run by hand on real hardware. This cannot be delegated.
4. **Release tag push** — pushing the `1.0.0` tag is the single irreversible action in this phase. Do this only after the acceptance gate is fully green.
