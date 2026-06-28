# Phase 4 Planning — First-sync + Conflicts

**Date:** 2026-04-30
**Milestone:** Phase 4 — First-sync + conflicts
**Modules in scope:** `src/ui/diff.ts` (new), `src/ui/modals/` (new), `src/main.ts` (wiring update)

---

## Goal

Ship the two interactive modal seams (`ConflictResolver`, `FirstSyncResolver`) so `always-ask` works end-to-end. Phase 3 left both seams stubbed by `PolicyBasedResolver`, which throws `SyncNeedsUIError` for `always-ask`. After Phase 4 the plugin runs an end-to-end `always-ask` sync — both an ordinary mid-stream conflict resolution and a from-cold first-sync — without requiring the user to switch policies.

No engine, GitHub-client, or adapter changes. The two resolver interfaces in `src/sync-engine-types.ts` are the only contracts Phase 4 implements against.

---

## Decisions

### Diff library: `diff` (npm)

§8.3 says "use the `diff` package or hand-roll Myers." `diff` is well-tested, ~30 KB minified, and removes a class of bugs (whitespace-sensitive line splitting, trailing-newline handling) we'd otherwise have to chase ourselves. Bundle weight is acceptable for v1; the alternative is ~150 LOC of hand-rolled diff that would need its own test suite.

Pure wrapper module `src/ui/diff.ts` produces a `DiffLine[]` array — `{ kind: 'context' | 'add' | 'remove', text }`. This keeps modal renderers dumb and the diff layer unit-testable in pure Node.

### Remote content fetched lazily, per-row, by the modal

The `ConflictItem` shape (`{path, action, local, remote}`) carries no bytes. Two ways to surface remote content for the diff view:

(a) The modal calls `GitHubClient.getBlob()` itself when the user expands a row, with a small in-modal cache.
(b) The engine pre-fetches all conflicted remote blobs and passes them through a richer resolver interface.

**Choice: (a).** Avoids interface churn. Aligns with §8.3's framing of the diff view as a per-row UI concern. Saves bandwidth when the user resolves without expanding (e.g. picking `keep-local` blind for a path they recognise). The modal keeps an in-flight cache so re-expanding a row does not re-fetch.

Local content is read via the `VaultAdapter` already injected — `readText` for non-binary, `readBinary` for binary.

### Mobile layout: stacked unified, driven by CSS

§8.3 explicitly: "two-way diff view: local on the left, remote on the right (or stacked unified on mobile)." We render the same DOM on both platforms (one column of diff lines tagged `add`/`remove`/`context`), and switch between side-by-side and stacked unified via a CSS media query plus a `.cawsync-mobile` body class set when `Platform.isMobileApp` is true. No platform branching in the component tree. Same row component used by both modals.

### Virtualized list for the conflict rows

Both modals can encounter large lists (first-sync against a multi-thousand-file repo, ordinary sync after a long divergence). Render only the visible rows plus a small overscan, total scroll height computed from row count × row height. Library choice deferred to the implementation issue but I'd start with hand-rolled (window scroll + slice) and pull in `@tanstack/virtual` only if needed.

Selection state lives in a `Map<string, ConflictResolution>` outside the DOM so it survives unmount/remount when rows scroll out.

### Modal contract: idempotent, await-once

Each modal exposes a single async method: `open(items): Promise<Map<path, resolution> | 'cancel'>`. The promise resolves when the user clicks "Apply selections and sync" or "Cancel sync"; the modal closes itself before resolving. Re-opening a closed modal is a fresh state.

### Apply button gating

`Apply selections and sync` is disabled until *every* item has a resolution recorded. No "select all → keep local" / "select all → keep remote" shortcut in v1; spec calls it out as deferred to v1.1+ (§12 implicitly).

### Binary file handling in conflicts

Per §8.3: "for binary files, the diff view shows '(binary file, N bytes locally, M bytes remotely)' instead of content — no diff rendering." Detect via the existing `isBinary` flag on `LocalChange` / `RemoteChange`. The row component swaps its body for a single-line summary in this case.

The first-sync modal handles binaries identically — same row component.

### First-sync confirmation checkbox

§8.4 requires: "I understand this will pull `<N>` remote-only files into my vault and push `<M>` local-only files to GitHub." The checkbox is required to enable the apply button *in addition to* every conflict having a resolution. Counts come from `FirstSyncSummary.remoteOnly.length` and `localOnly.length`.

### Wiring into `main.ts`

When `conflictPolicy === 'always-ask'`, inject the modal-backed resolvers. Otherwise keep `PolicyBasedResolver`. The `always-ask` placeholder error toast added in Phase 3 (`§2.3` of the planning doc) is removed in this phase.

---

## Issues created

Phase 4 work (`phase: 4`):

| # | Title | Type | Depends on |
|---|---|---|---|
| #81 | `src/ui/diff.ts` line-level diff utility wrapping `diff` | feature | — |
| #82 | `ConflictResolutionModal` (§8.3) implementing `ConflictResolver` | feature | #81 |
| #83 | `FirstSyncModal` (§8.4) implementing `FirstSyncResolver` | feature | #81, #82 (row component) |
| #84 | Wire modal-backed resolvers into `main.ts` | feature | #82, #83 |
| #85 | Phase 4 retrospective | docs | all above |

### Recommended order

#81 ships first. #82 and #83 can run in parallel once #81 is merged; #83 reuses the row component from #82 so it's slightly cleaner if #82 lands first. #84 is the integration point. #85 closes the phase.

---

## Open questions deferred

- **Side-by-side desktop layout: column widths.** Equal-split (50/50) is the simple default. If long lines wrap aggressively it may be worth giving the side with longer lines more room. Decide visually in (B).
- **Diff "expand context" affordance.** v1 renders the full file diff with no collapsed-context shortcut (`...20 unchanged lines...`). If files routinely exceed ~500 lines this is unpleasant — revisit after manual testing if it bites.
- **Selection persistence across sync retries.** If `applyPush` hits a 422 fast-forward retry, the engine re-runs `classify` and may emit a different conflict set. Resolutions from the first pass don't carry over. Acceptable for v1 — retries are rare and the user can re-resolve. Note in CLAUDE.md if confusing in practice.
- **First-sync modal scrolling vs. paginated.** Virtualized scrolling is the plan. If 5,000 conflicts feels overwhelming we may want explicit pagination + a per-page summary; defer until we hit it.

---

## Definition of done for Phase 4

- All five Phase 4 issues closed.
- `npm test`, `npm run lint`, `npm run typecheck` pass on `main`.
- Plugin runs an end-to-end `always-ask` conflict-resolution sync (manual smoke test): induce a conflict, resolve via the modal, verify the commit and the vault.
- Plugin runs an end-to-end first-sync via the modal against a populated repo + populated vault.
- Conflict modal usable on a phone-width screen (informal test: 5 conflicts resolvable without scroll rage, per acceptance §15).
- PAT remains absent from `sync.log` after a conflict-resolution sync (regression check).
- Phase 4 retrospective issue confirms `docs/design-specification.md` and `CLAUDE.md` reflect what was built.

---

## Human gates remaining for Phase 4

Per `docs/workflow.md`:

1. **Phase planning sign-off** — review this summary and the five issues; confirm readiness.
2. **Per-PR review** — `/review` with Phase 3+ focus (mobile layout, iOS-specific behavior, accessibility) on each PR.
3. **Phase gate** — confirm Phase 4 is done before requesting Phase 5 (BRAT release) planning.
