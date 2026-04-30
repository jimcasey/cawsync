# Phase 3 Retrospective — UI

**Date:** 2026-04-30
**Milestone:** Phase 3 — UI
**Issues closed:** #62, #63, #64, #65, #66, #67, #68

---

## 1. What was built

All seven implementation issues shipped. The table below summarises each module or file, its issue, its LOC, and its test count.

| Module / File | Issue | LOC | Tests | Notes |
|---|---|---|---|---|
| `src/obsidian-vault-adapter.ts` | #62 | 75 | 15 | Production `VaultAdapter`; create-vs-modify distinction; `isTFile()` duck-typed guard; dotfile fallback |
| `src/obsidian-state-adapter.ts` | #63 | 22 | 5 | Thin passthrough to `DataAdapter`; `exists`, `read`, `write`, `rename` |
| `src/ui/settings-tab.ts` | #64, #67 | 290 | — | `JackdawSettingsTab`; Connection, Sync behavior, Inclusion, Diagnostics sections; `SyncLogModal`; `ResetSyncStateModal` |
| `src/ui/ribbon.ts` | #65 | 17 | — | `RibbonIcon`; `setSyncing()` / `setIdle()` CSS class toggle |
| `src/ui/status-bar.ts` | #65 | 31 | — | `StatusBar`; `setIdle()`, `setSyncing()`, `setError()` |
| `styles.css` | #65 | 5 | — | `jackdaw-syncing` spin animation |
| `src/classifier.ts` | #66 | 83 | 23 | Added §4.4 staleness detection; `state-refresh` action; grew from 71 LOC / 20 tests |
| `src/sync-notice.ts` | #68 | 59 | 9 | `formatSyncOutcome()`; extracted from `main.ts` for testability |
| `src/main.ts` | #68 | 164 | — | `JackdawPlugin`; component wiring; `runSync()`; `handleSyncResult()`; Android short-circuit |

**Quality gates at close:**
- `npm test`: 221 tests, 16 files, all pass (up from 187 / 13 at Phase 2 close)
- `npm run lint`: no findings
- `npm run typecheck`: no errors

---

## 2. Divergences from the design spec

### 2.1 `sync-notice.ts` as a new module not specified by the spec

**Spec:** §8.5 describes sync notices as behaviour of `main.ts`. No separate module is mentioned.

**What shipped:** `src/sync-notice.ts` exports `formatSyncOutcome()`, which maps a `SyncResult` to `{ toasts: string[], statusBar: StatusBarUpdate }`. `main.ts` acts on this struct — it calls `new Notice()` and updates the status bar — but contains no notice formatting logic itself.

**Resolution:** Extracting notice logic to its own module lets the 9-test `sync-notice.test.ts` cover every result path without an Obsidian dependency. This is a refinement, not a contradiction. No spec update needed.

### 2.2 `'state-refresh'` as a distinct `ClassifyAction`

**Spec:** §4.4 says to "treat as no-op, update state silently." This implies the existing `'no-op'` action with a flag, or an in-engine check.

**What shipped:** `ClassifyAction` gains a fifth value: `'state-refresh'`. The classifier emits it when staleness is detected (local blob SHA matches remote blob SHA despite both differing from state). The engine handles `'state-refresh'` paths by updating `state.files[path]` without any vault or remote I/O.

**Resolution:** Using a distinct action avoids overloading `'no-op'` with engine-side effects, keeps the engine's action dispatch table explicit, and makes the staleness path visible in tests. `sync-engine-types.ts` carries the updated `ClassifyAction` union; CLAUDE.md §Architecture has been updated to list the five values and document the staleness-detection behaviour.

### 2.3 `ObsidianVaultAdapter` uses a try-catch dotfile fallback rather than pre-checking

**Spec / issue #62:** "If `getAbstractFileByPath()` returns a `TFile`, call `vault.modify`; otherwise fall through to `adapter.write`."

**What shipped:** `writeText` and `writeBinary` attempt `vault.create()` first and fall back to `adapter.write()` only when `create()` throws. This is because `vault.create()` fires Obsidian's internal file-created event for indexed paths, which is the desired behaviour; the fallback catches the case where the path is under `.obsidian/` and not vault-managed.

**Resolution:** Functionally equivalent for all observed paths. The try-catch approach avoids a separate `exists()` call and correctly handles paths that are vault-indexed but not yet on disk. No spec update needed.

### 2.4 `isRunningSync` UI concurrency guard in `main.ts`

**Spec:** §8.2 and §8.5 describe sync invocation but do not specify what happens if the user clicks the ribbon a second time while a sync is in flight.

**What shipped:** `main.ts` adds an `isRunningSync: boolean` field. A second `runSync()` call returns immediately while a sync is in flight. Without this guard, a second click would toggle `jackdaw-syncing` off via the first call's `finally` block while the first sync was still running.

**Resolution:** This is a necessary UI correctness fix absent from the spec. The spec should note it in §8.2: "If a sync is already in progress, ignore ribbon click and command invocations." Captured here; spec update deferred to the next editing pass.

### 2.5 `isTFile()` duck-typed guard instead of `instanceof TFile`

**Spec:** §5.7 and the issue #62 description imply normal `instanceof` checks.

**What shipped:** `ObsidianVaultAdapter` uses `function isTFile(file: unknown): file is TFile { return file != null && 'extension' in (file as object); }` instead of `file instanceof TFile`. Importing `TFile` as a value (not a type) would make the module depend on an Obsidian runtime object, breaking unit tests that run in pure Node.

**Resolution:** The duck-typed check is safe: only `TFile` objects carry an `extension` property in Obsidian's abstract file tree. This pattern should be documented in CLAUDE.md as the preferred approach for any new module that needs to branch on Obsidian class identity without importing the class as a value.

### 2.6 Diagnostics section merged into `settings-tab.ts`

**Spec / planning:** The Phase 3 planning session split Diagnostics (#67) into a separate issue from the other settings sections (#64) to keep PRs reviewable. The planning doc also floated `src/adapters.ts` for `ObsidianStateAdapter`.

**What shipped:** Both issues' output landed in `src/ui/settings-tab.ts` (one module, one class, four sections). `ObsidianStateAdapter` got its own `src/obsidian-state-adapter.ts` as issue #63 specified — the "or a tiny `src/adapters.ts` module" option from the planning session was not taken.

**Resolution:** No divergence from the final issue specs; the split was a review convenience, not an architecture decision. Confirmed correct.

---

## 3. Surprising decisions and patterns to carry into Phase 4

**`sync-notice.ts` as an adapter between engine types and Obsidian APIs.** The pattern — map a typed result to a plain `{ toasts, statusBar }` struct, then let `main.ts` call the Obsidian APIs — is highly testable and keeps `main.ts` free of branching logic. Use it for the conflict modal: the modal should return a typed resolution map; `main.ts` feeds it to the engine.

**`PolicyBasedResolver` as a zero-UI seam works well.** Phase 3 shipped a fully functional plugin for `always-prefer-local` and `always-prefer-remote` users before any modal code existed. Phase 4 only needs to provide `ConflictResolver` and `FirstSyncResolver` implementations and inject them in place of `PolicyBasedResolver` in `main.ts`. No engine changes required.

**`state-refresh` as a first-class action rather than a flag.** Pattern: when a new action type is needed that affects only engine-side state (no vault or remote I/O), add a new `ClassifyAction` value and handle it explicitly. Avoids ambiguous `'no-op'` overloading.

**`isRunningSync` guard at the plugin layer, not the engine layer.** The engine has its own `isSyncing` lock that returns `{ status: 'cancelled' }` on reentry. The plugin-layer guard is separate and returns before calling `engine.sync()` at all, preventing the spinner from being toggled off prematurely by the early-cancelled second invocation. Two layers, two responsibilities.

---

## 4. Items explicitly deferred

| Item | Deferred to | Notes |
|---|---|---|
| Conflict resolution modal | Phase 4 | `ConflictResolver` interface is the seam; `PolicyBasedResolver` handles auto-resolve policies in the interim |
| First-sync modal | Phase 4 | `FirstSyncResolver` interface is the seam |
| Real `always-ask` conflict UI | Phase 4 | Produces `SyncNeedsUIError` placeholder toast until modal ships |
| Integration tests (§11.2) | Phase 5 | Requires CI-owned GitHub account and per-run fresh branches |
| End-to-end smoke test on iOS | Phase 5 / manual | §11.3 — highest-priority derisking step before release |
| `isRunningSync` guard spec update | Next editing pass | §8.2 should note that a second click while syncing is ignored |
| CLAUDE.md architecture section | Done (this retro) | Updated to list all Phase 2/3 modules and drop stale "not yet implemented" markers |
| `isTFile()` pattern in CLAUDE.md | Done (this retro) | Documented under `obsidian-vault-adapter.ts` entry in CLAUDE.md |

---

## 5. Phase 4 readiness

**Confirmed.** All Phase 3 issues (#62–#68) are closed. Quality gates pass: 221 tests green, lint clean, typecheck clean. The plugin entry point (`main.ts`) wires the full Phase 2 engine to Obsidian UI via production adapters. The two deferred modal seams (`ConflictResolver` and `FirstSyncResolver`) are injected at construction time in `main.ts` and require no engine changes to swap in Phase 4 implementations.

Phase 4 scope: conflict resolution modal, first-sync modal, and `main.ts` injection updates. No changes to the sync engine, GitHub client, state store, or adapter layers.
