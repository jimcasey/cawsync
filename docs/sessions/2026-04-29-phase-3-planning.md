# Phase 3 Planning — UI

**Date:** 2026-04-29
**Milestone:** Phase 3 — UI
**Modules in scope:** `src/main.ts`, `src/ui/` (new), production `VaultAdapter` + `StateAdapter` implementations, sync-state staleness handling

---

## Goal

Wire the Phase 2 sync engine into a real Obsidian plugin: a settings tab, a ribbon icon, a command, a status bar, sync-result notices, and the production adapters that bridge the engine to `app.vault`. After Phase 3 the plugin should run an end-to-end sync from a button click on Obsidian desktop, with the conflict-resolution modal stub still throwing `SyncNeedsUIError` for `always-ask` until Phase 4.

---

## Decisions

### `always-ask` is allowed in Phase 3, with a clear error notice

`DEFAULT_SETTINGS.conflictPolicy` stays `always-ask`. When the engine throws `SyncNeedsUIError`, the sync-notice handler surfaces it as a toast: *"Conflict resolution UI is not yet available. Choose 'Prefer local' or 'Prefer remote' in settings, or wait for the next release."* This preserves spec intent (the §8.1 default), defers the real fix to Phase 4, and avoids changing a user-visible default twice.

### Settings tab split into two issues

§8.1 has four sections plus three diagnostic actions (test connection, view log modal, reset sync state). Splitting into one issue for the form sections (Connection, Sync behavior, Inclusion) and one for Diagnostics keeps each PR small enough to review carefully — the diagnostics issue is the only one that pulls in the GitHub client and a read-only modal.

### Diagnostic "view log" modal is in scope; conflict and first-sync modals are not

§8.1 mentions a read-only log viewer modal. It's a static viewer, not an interactive resolver, so it ships with Phase 3. The conflict resolution modal (§8.3) and first-sync modal (§8.4) remain Phase 4. Phase 4's modals will satisfy the `ConflictResolver` and `FirstSyncResolver` interfaces injected at the engine seam.

### Status bar is desktop-only

§8.2 is explicit. Phase 3 uses `Platform.isMobileApp` to skip status bar registration. Mobile gets the ribbon icon and command palette entry only.

### Staleness detection (§4.4) is Phase 3

Deferred from Phase 2 via §2.4 of the retro. The fix touches the classifier and/or pull phase, not the UI, but Phase 3 already has us re-touching the engine seam during `main.ts` wire-up. Doing it here keeps the engine "complete" before Phase 4 starts. The case is low-frequency (two Obsidian Sync devices syncing faster than Obsidian Sync propagates `sync-state.json`) and the worst-case symptom today is an unnecessary conflict prompt — no data loss.

### Production `VaultAdapter` maps `writeText`/`writeBinary` to create-vs-modify

The `VaultAdapter` interface defined in Phase 2 is deliberately one method per direction — the production wrapper handles the `vault.create` vs `vault.modify` distinction internally by checking `app.vault.getAbstractFileByPath(path)`. Same pattern for binary. Listing uses `app.vault.getFiles()` for indexed files and `app.vault.adapter.list()` for `.obsidian` walk when `includeObsidianConfig` is enabled.

### Production `StateAdapter` is a thin wrapper around `app.vault.adapter`

Four methods (`exists`, `read`, `write`, `rename`) — direct passthrough. Lives in `src/main.ts` or a tiny `src/adapters.ts` module; not worth its own dedicated file unless it grows.

### Ribbon icon spinning during sync

§8.2 says the ribbon icon spins while a sync is in progress. Implementation is a CSS class toggled on the ribbon element from the sync-notice handler in `main.ts`. The CSS lives next to the plugin (`styles.css`).

### Sync notices follow §8.5 exactly

- Sync started → no toast (ribbon spinner is the indicator).
- `up-to-date` → toast: "Already up to date."
- `success` → toast: "Synced N changes." where N is `filesAdded + filesModified + filesDeleted`.
- `error` → toast: "Sync failed: <message>. See log for details." (or the `always-ask` message above when the error is `SyncNeedsUIError`).
- `cancelled` → no toast (user cancelled, no need to confirm).
- Skipped oversized files → second toast listing the first 3 by name with "and N more" suffix.

### `main.ts` is the integration seam

It owns: `loadData`/`saveData` for `Settings`, instantiation of `Logger`/`StateStore`/`GitHubClient`/`SyncEngine`, the `PolicyBasedResolver` injection (Phase 4 swaps in real modals), ribbon/command/status-bar registration, the sync-result toast handler, and the Android short-circuit. No business logic; just wiring.

---

## Issues created

Phase 3 work (`phase: 3`):

| # | Title | Type | Depends on |
|---|---|---|---|
| #62 | Production `VaultAdapter` wrapping `app.vault` / `app.vault.adapter` | feature | — |
| #63 | Production `StateAdapter` wrapping `app.vault.adapter` | feature | — |
| #64 | Settings tab — Connection, Sync behavior, Inclusion sections | feature | — |
| #65 | Ribbon icon, command palette entry, status bar (desktop) | feature | — |
| #66 | Staleness detection (§4.4) in classifier/pull | feature | — |
| #67 | Settings tab — Diagnostics (test connection, view-log modal, reset sync state) | feature | #64 |
| #68 | `main.ts` plugin entry — wire engine + UI + settings persistence + sync notices | feature | #62, #63, #64, #65 |
| #69 | Phase 3 retrospective | docs | all above |

### Recommended order

Issues #62, #63, #64, #65, and #66 are independent and can run in parallel. #67 depends on #64 (the diagnostic actions live inside the settings tab). #68 is the integration point and depends on #62, #63, #64, #65. #69 runs last.

---

## Open questions deferred

- **Pretty vs. minified `sync-state.json` in release builds.** Phase 1 left this as a constructor flag on `StateStore`. The Phase 3 wire-up will pick a default; I'd suggest minified for release, pretty when `verboseLogging` is on. Final decision lives in #6.
- **Ribbon icon name.** Currently `'sync'`. Obsidian's built-in `'refresh-cw'` may be a better fit visually. Leave to #5.
- **Reset sync state — confirm dialog or two-click?** §8.1 says "with a confirmation dialog." A native `confirm()` works on desktop but may render oddly on iOS. #4 should use Obsidian's `Modal` for consistency.
- **`always-ask` UI affordance.** If user feedback in Phase 5 testing finds the error toast confusing, we can re-evaluate hiding `always-ask` from the dropdown until Phase 4. Captured here so we don't lose the option.

---

## Definition of done for Phase 3

- All eight Phase 3 issues (#62–#69) closed.
- `npm test`, `npm run lint`, `npm run typecheck` pass on `main`.
- Plugin loads in Obsidian desktop, ribbon click runs a real sync against a live repo (manual smoke test).
- Settings tab is keyboard-navigable and renders without horizontal overflow at phone widths.
- PAT remains absent from `sync.log` after a full end-to-end sync.
- Issue #8 (retrospective) confirms `docs/design-specification.md` and `CLAUDE.md` reflect what was actually built and any divergences have follow-up issues.

---

## Human gates remaining for Phase 3

Per `docs/workflow.md`:

1. **Phase planning sign-off** — review this summary and the eight issues; confirm readiness.
2. **Per-PR review** — for each Phase 3 PR: read `/review` findings (focus per workflow.md Phase 3+ guidance: mobile layout, iOS-specific behavior, accessibility), review the diff, squash-merge.
3. **Phase gate** — confirm Phase 3 is done before requesting Phase 4 planning.
