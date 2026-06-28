# Phase 4 Retrospective — First-sync + Conflicts

**Date:** 2026-04-30
**Milestone:** Phase 4 — First-sync + conflicts
**Issues closed:** #81, #82, #83, #84

---

## 1. What was built

All four implementation issues shipped. The table below summarises each module, its issue, its LOC, and its test count.

| Module / File | Issue | LOC | Tests | Notes |
|---|---|---|---|---|
| `src/ui/diff.ts` | #81 | 52 | 11 | `computeLineDiff()` wraps `diff.diffLines`; emits `DiffLine[]` with kind + per-side line numbers |
| `src/ui/modals/conflict-row.ts` | #82 | 116 | 11 | `createConflictRow()`; collapsed/expanded state; loading/error/binary/text content states; reused by both modals |
| `src/ui/modals/virtualized-list.ts` | #82 | 60 | 9 | `computeVirtualWindow()`; pure function — viewport + variable-height rows + overscan |
| `src/ui/modals/conflict-resolution-modal.ts` | #82 | 251 | — | `ConflictResolutionModal` (mid-sync); lazy per-row `getBlob` with in-modal cache; mobile class toggle |
| `src/ui/modals/first-sync-modal.ts` | #83 | 289 | — | `FirstSyncModal` with summary block + confirmation checkbox; reuses row + virtualized list |
| `src/sync-engine-types.ts` | #84, #96 | 153 (+46) | 7 (new policy-aware tests) | `ConflictItem` extended (`isBinary`, `localSize`, `remoteSize`, `remoteBlobSha`); `PolicyBasedResolver` switched to lazy `() => ConflictPolicy`; `PolicyAwareConflictResolver` + `PolicyAwareFirstSyncResolver` introduced |
| `src/sync-engine.ts` | #84 | 28 changed | — | Engine no longer instantiates `PolicyBasedResolver` or branches on `conflictPolicy`; always calls `this.conflicts.resolve()`; enriches `ConflictItem`s from `LocalChange`/`RemoteChange` before handing them to the resolver |
| `src/first-sync.ts` | #84 | 11 changed | — | Populates the new `ConflictItem` fields when emitting added/added conflicts |
| `src/main.ts` | #84 | 28 changed | — | Wires `ConflictResolutionModal` + `FirstSyncModal` through `PolicyAware*` wrappers; `repoCoords` closure for live owner/repo; placeholder `SyncNeedsUIError` toast removed |
| `src/sync-notice.ts` | #84 | 10 changed | — | `SyncNeedsUIError` branch removed; new `GHEmptyRepoError` branch added (#99) |
| `styles.css` | #82, #83 | 196 added | — | Modal layout, virtualized list positioning, side-by-side diff (CSS grid), mobile stacked unified, first-sync summary block |

**Quality gates at close:**
- `npm test`: 271 tests, 21 files, all pass (up from 221 / 16 at Phase 3 close)
- `npm run lint`: no findings
- `npm run typecheck`: no errors

**New test files:** `diff.test.ts` (11), `conflict-row.test.ts` (11), `virtualized-list.test.ts` (9), `policy-aware-resolver.test.ts` (7), `policy-based-resolver.test.ts` (5 — backfilled when constructor changed).

---

## 2. Divergences from the design spec

### 2.1 `ConflictItem` carries binary/size/blobSha fields beyond `ClassifiedPath`

**Spec:** §5.5 / §5.7 / §8.3 do not define a richer `ConflictItem` shape — `ClassifiedPath` was implicitly the contract.

**What shipped:** `ConflictItem` extends `ClassifiedPath` with `isBinary`, `localSize`, `remoteSize`, `remoteBlobSha`. The engine populates these from the `LocalChange` / `RemoteChange` maps before handing the array to the resolver. The first-sync flow populates the same fields when it emits added/added conflicts.

**Resolution:** This is the load-bearing contract change for Phase 4. The modals need `remoteBlobSha` to call `getBlob()` lazily (planning decision (a)), `isBinary` to swap the diff body for the byte-count summary, and the two sizes to render that summary. Without these fields, the modal would have to re-derive them by re-scanning local + re-fetching the remote tree, which would be wasteful and would tightly couple the modal to lower-level engine internals. Spec §8.3 should be amended to note that the resolver receives sufficient context to render the diff without re-querying the engine; deferred to next editing pass.

### 2.2 Conflict rows are collapsed by default; diff loads on expand

**Spec / §8.3:** "For each conflict, a row with: File path, Two-way diff view ..., Two buttons" reads as if the diff is always rendered inline.

**What shipped:** Rows render in a collapsed state showing only the path + two buttons. Clicking the caret expands the body, which then triggers `loadContent()` — an async path that fetches local text via `VaultAdapter.readText`, fetches remote bytes via `GitHubClient.getBlob`, and computes the line diff. Loading / error / binary / text are four distinct row content states.

**Resolution:** The planning doc explicitly chose lazy per-row fetching (option (a) in §"Remote content fetched lazily"). Always rendering every diff would: (1) require an O(N) fetch of every conflicted blob before the modal opens, blocking the user; (2) render thousands of pre-loaded `<pre>` blocks for first-sync against a populated repo, defeating virtualization. The collapsed default is the right choice but the spec wording does not capture it. Defer a §8.3 update to confirm the collapsed-by-default + lazy-expand behaviour.

### 2.3 `PolicyBasedResolver` constructor takes a getter, not a value

**Spec:** Implicit value-typed policy passed at construction.

**What shipped (#96):** `PolicyBasedResolver` now takes `getPolicy: () => ConflictPolicy`. The previous shape made `PolicyAwareConflictResolver` impossible to test correctly: the wrapper changes which path it takes based on the live setting, so the inner `PolicyBasedResolver` had to be re-instantiated on every resolve, which meant either reconstructing it inside the wrapper (awkward) or passing the getter through (chosen).

**Resolution:** Functionally a non-event from the user's perspective. The getter pattern is consistent with how `main.ts` passes settings to `SyncEngine` and `Logger`. No spec update needed.

### 2.4 `PolicyAwareConflictResolver` / `PolicyAwareFirstSyncResolver` as the engine-facing seam

**Spec:** §6 / §8.3 imply the engine receives a single `ConflictResolver` and that the engine itself decides whether to short-circuit on `conflictPolicy === 'always-ask'` vs not.

**What shipped:** The engine is now policy-agnostic: it always calls `this.conflicts.resolve()`. The two `PolicyAware*` wrappers in `sync-engine-types.ts` branch internally — `always-ask` → modal; otherwise → `PolicyBasedResolver`. `main.ts` constructs the wrappers and injects them.

**Resolution:** This is a cleaner architecture than what the spec implied: the engine has one less responsibility, and the wrappers are unit-testable in pure Node (the modal is mocked behind the `ConflictResolver` interface). This pattern was foreshadowed in the Phase 3 retro under "PolicyBasedResolver as a zero-UI seam works well." No spec update needed; the existing §6 wording is broad enough to cover this layering.

### 2.5 Helper modules `conflict-row.ts` and `virtualized-list.ts` not anticipated by the spec

**Spec:** §8.3 / §8.4 describe the modals as monolithic.

**What shipped:** The conflict row is a standalone factory function returning a `ConflictRowController` with `setResolution` / `setExpanded` / `setContent` mutators. Both modals consume it identically. The virtualized list is a pure `computeVirtualWindow()` function that returns `{startIndex, endIndex, totalHeight, offsetY}` given `scrollTop`, viewport, item count, and a per-item height function.

**Resolution:** Splitting these out lets the row + virtualization logic be tested in JSDOM and pure Node respectively, without an Obsidian dependency. The two modals (251 + 289 LOC) become almost identical scaffolding, which is a smell that's worth addressing in Phase 5 if the duplication grows; for now the duplication is acceptable and each modal owns its own DOM lifecycle.

### 2.6 Mobile layout via CSS only, no JS branching

**Planning decision:** "Render the same DOM on both platforms (one column of diff lines tagged `add`/`remove`/`context`), and switch between side-by-side and stacked unified via a CSS media query plus a `.cawsync-mobile` body class."

**What shipped:** Side-by-side diff is implemented via `display: grid; grid-template-columns: 1fr 1fr` with `add` lines pinned to column 2 and `remove` lines pinned to column 1. Mobile stacks via `.cawsync-mobile .cawsync-diff { display: block; }` overriding the grid. The class is set on `modalEl` from `Platform.isMobileApp` at `onOpen()` time. No JS branching in either the row component or the modals.

**Resolution:** Aligns with the planning doc. No spec update needed.

### 2.7 `GHEmptyRepoError` and connection-test surface area

**Spec:** §6 lists six typed error classes (`GHAuthError`, `GHNotFoundError`, `GHRateLimitError`, `GHFastForwardError`, `GHNetworkError`, `GHServerError`). The empty-repo case isn't enumerated.

**What shipped (#98, #99):** A seventh error class, `GHEmptyRepoError`, is thrown from the `request()` 409 path and from a probe inside `getBranch()` that distinguishes empty-repo from missing-repo/branch when the initial `branches/<name>` returns 404. `sync-notice.ts` and the settings-tab "Test connection" handler both surface it with a friendlier message.

**Resolution:** This came up in Phase 4 when the first-sync modal would otherwise hit a generic 404 against a freshly-created repo with no commits. CLAUDE.md is updated in this retro PR to list `GHEmptyRepoError` alongside the other six classes under `src/github-client.ts`. A spec amendment to §6 is deferred to the next editing pass.

### 2.8 `state-store.ts` pre-removes canonical before rename

**Spec:** §7 / §8 describe atomic write via `tmp` + `rename` and don't mention an explicit pre-`remove`.

**What shipped (#102):** `StateStore.save()` checks `exists(canonicalPath)` and calls `adapter.remove(canonicalPath)` before `rename(tmp, canonical)`. Obsidian's `DataAdapter.rename` throws "Destination file already exists!" when the destination exists, so without the pre-remove, the second save and every subsequent save would fail. The recovery path in `load()` already handles the window where `tmp` exists but `canonical` does not.

**Resolution:** This is an Obsidian-specific quirk that the spec couldn't have anticipated. Atomicity is preserved (`tmp` is fully written before the canonical is removed; `load()` recovers from `tmp` if the rename window is interrupted). Note this in CLAUDE.md under `src/state-store.ts` if it bites us again; otherwise the behaviour is correctly captured by the existing description ("Atomic writes via temp-file-and-rename").

### 2.9 `SyncLogModal` Copy + log path hint (#100, #101)

**Spec:** §8.1 mentions the View Log button but doesn't specify modal contents beyond "read-only modal."

**What shipped:** `SyncLogModal` renders the log inside a horizontally-scrollable `<pre>`, displays the absolute log path + rotated copy filename, and adds a Copy button using `navigator.clipboard.writeText`. The modal Pre was previously overflowing the modal width.

**Resolution:** Pure UX hardening. No spec update needed.

---

## 3. Surprising decisions and patterns to carry into Phase 5

**Pure-DOM helper components return controllers with mutator functions.** `createConflictRow()` returns `{ el, setResolution, setExpanded, setContent }`. The modal owns the lifecycle (`appendChild` / `remove`); the helper owns the DOM element + state mutations. This pattern lets the row be tested in JSDOM without instantiating an Obsidian `Modal`, and it lets the modal swap content without re-rendering.

**Virtualization as a pure function.** `computeVirtualWindow()` takes scroll/viewport/item-count/height-fn and returns a window descriptor. No DOM dependency, no class. The modals call it inside their `renderVisible()` and use the returned `{startIndex, endIndex, offsetY}` to position absolutely-positioned row elements. Phase 5's settings-tab improvements (when they come) might benefit from this same pattern for scrollable previews.

**Engine fully policy-agnostic.** Phase 3 had `SyncEngine` instantiate `PolicyBasedResolver(conflictPolicy)` internally for non-`always-ask` paths; Phase 4 deleted that instantiation. The engine now treats every conflict the same — call the resolver — and the wrappers handle policy. This delete is the kind of cleanup that's only safe once the wrappers exist; doing it earlier would've meant `always-ask` was unreachable. Worth noting: the simpler engine compiles without changes when adding a future fourth policy.

**Lazy per-row content fetch with in-modal cache.** Pattern: hold `Map<path, ContentState>`; on expand, set `loading`, await fetch, set `text|binary|error`. Cache survives row unmount when the user scrolls away, so re-expansion is instant. The same pattern would work for any future tree-of-blobs UI (e.g. the deferred "Reload" button).

**`ConflictItem` enrichment in the engine.** Pattern: when a layer above the engine needs richer context than `ClassifiedPath`, do the enrichment in one place (`SyncEngine.runOnce`) using the `LocalChange` / `RemoteChange` maps the engine already has. Avoid having the modal do it (which would couple the modal to both maps).

---

## 4. Items explicitly deferred

| Item | Deferred to | Notes |
|---|---|---|
| Integration tests against real GitHub (§11.2) | Phase 5 | Requires CI-owned GitHub account and per-run fresh branches; biggest hole in current coverage |
| Desktop end-to-end smoke: `always-ask` conflict resolved via modal | Phase 5 / manual | Per #85 checklist; not verified in this retro PR |
| Desktop end-to-end smoke: first-sync against populated repo + populated vault via modal | Phase 5 / manual | Per #85 checklist; not verified in this retro PR |
| Mobile-width usability check: 5 conflicts resolvable on a phone-width screen | Phase 5 / manual | Per #85 checklist + spec §15; not verified in this retro PR |
| PAT-absent regression check on `sync.log` after a conflict-resolution sync | Phase 5 / manual | Per #85 checklist; not verified in this retro PR |
| iOS manual smoke test (§11.3) | Phase 5 / manual | Single most important derisking step before BRAT release |
| Obsidian Sync coexistence test (§4.4 staleness path) | Phase 5 | Classifier emits `state-refresh`; needs an end-to-end test with two devices |
| README + screenshots | Phase 5 | Required for BRAT discoverability |
| BRAT release setup | Phase 5 | `manifest.json` + GitHub release tagging |
| §8.3 amendment: collapsed-by-default + lazy-expand | Spec editing pass | Captured in §2.2 above |
| §6 amendment: add `GHEmptyRepoError` to error-class enumeration | Spec editing pass | Captured in §2.7 above |
| `CLAUDE.md` `GHEmptyRepoError` mention | Done (this retro) | Updated in `src/github-client.ts` entry |
| `CLAUDE.md` modal architecture entries | Done (this retro) | New entries for `src/ui/diff.ts`, `src/ui/modals/*` |
| Project status line | Done (this retro) | Now reads "Phase 4 (UI conflicts) is complete. Phase 5 (BRAT release) is next." |
| "Select all → keep local" / "Select all → keep remote" shortcut | v1.1+ | Per §12, deferred per planning decision |
| Diff "expand context" affordance (`...20 unchanged lines...`) | v1.1+ if it bites | Per planning open question |
| Per-page pagination for very large first-sync conflict lists | v1.1+ if it bites | Virtualization handles current scale |

---

## 5. Phase 5 readiness

**Code-level: confirmed.** All Phase 4 issues (#81–#84) are closed. Quality gates pass: 271 tests green, lint clean, typecheck clean. `main.ts` constructs `ConflictResolutionModal` and `FirstSyncModal`, wraps them in `PolicyAware*` resolvers, and injects them into `SyncEngine`. The `SyncNeedsUIError` placeholder error toast has been removed from `main.ts` / `sync-notice.ts` (replaced by the modal path).

**Manual gates: not yet performed.** The four manual checks from #85's checklist — desktop end-to-end `always-ask` smoke, first-sync against a populated repo/vault, mobile-width usability, and PAT-absent log regression — are deferred to Phase 5 / manual (see §4). The retro records that the modal seam is wired and reachable in code but does not assert that the integrated UX has been observed.

Phase 5 scope: integration tests, the manual gates above, iOS manual testing, README + screenshots, BRAT release. No engine, classifier, GitHub-client, or modal changes anticipated.
