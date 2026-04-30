# Manual Testing

Steps to configure and manually test the plugin across platforms and phases.

---

## Desktop setup (Phase 3+ gate)

Before signing off on any phase from Phase 3 onward, smoke-test the plugin in Obsidian desktop:

1. Clone the repo into `<your-vault>/.obsidian/plugins/jackdaw/`.
2. Run `npm install && npm run build`.
3. In Obsidian → Settings → Community plugins, disable Safe mode and enable **Jackdaw**.
4. Open Settings → Jackdaw and enter:
   - **PAT** — a GitHub personal access token with `repo` scope.
   - **Repository** — `owner/repo` of a small test repo you control.
   - **Branch** — the branch to sync against (e.g. `main`).
5. Click the sync ribbon icon. Verify the status bar shows "Syncing…" and then a success message.
6. Make a local edit, sync again, and confirm the change appears in the GitHub repo.
7. Make a remote edit via the GitHub web UI, sync, and confirm the vault file is updated.

---

## iOS manual testing (Phase 5 gate)

Corresponds to §11.3 of the design specification. Run on a **physical iPhone** — this cannot be delegated or automated.

**Setup:**
1. Install Obsidian on the iPhone.
2. Install the plugin via BRAT (Settings → Community plugins → BRAT → Add beta plugin → paste the repo URL).
3. Configure PAT, repo, and branch in Settings → Jackdaw using the same small test repo.

**Scenarios — record pass/fail for each:**

| # | Scenario | Expected |
|---|---|---|
| 1 | First sync against an empty-ish test repo with a few existing files | First-sync modal appears; files are pulled; state is saved *(requires Phase 4)* |
| 2 | Edit a note on iOS only, then sync | Changed file is pushed to GitHub; no pull activity |
| 3 | Edit a file via GitHub web UI, then sync from iOS | File is pulled and updated in vault; no push |
| 4 | Edit the same file both locally and on GitHub, then sync | Conflict UI appears; resolving with either option applies cleanly |
| 5 | Force-quit Obsidian mid-sync, reopen, sync again | Plugin recovers; no duplicate or missing files; `.tmp` file is not left behind |
| 6 | Attach a file larger than the configured per-file size limit, then sync | File is skipped; a notice explains it was omitted due to size |
| 7 | Toggle airplane mode immediately after tapping sync | Sync fails gracefully; error notice appears; no partial state written |

Phase 5 does not close until all scenarios pass.

---

## Obsidian Sync coexistence testing (Phase 5 gate)

Corresponds to §11.4 of the design specification. Requires **two physical devices** both running Obsidian Sync and the Jackdaw plugin connected to the same vault and same test GitHub repo.

**Scenarios:**

1. **Normal two-device flow**
   - Edit a note on device A → sync to GitHub from A → wait for Obsidian Sync to propagate the updated `sync-state.json` to B → sync from B.
   - Expected: sync from B is a no-op; no conflict is raised.

2. **Stale state on device B (§4.4 case 3)**
   - Edit a note on device A → sync from A → immediately sync from B *before* Obsidian Sync has delivered the updated `sync-state.json`.
   - Expected: staleness is detected (local content hash matches remote blob hash despite differing from recorded state); file is treated as a no-op; state is updated silently.

3. **Three-way conflict**
   - Edit file X on device A. Edit file X via the GitHub web UI (creating a conflict on file X). Edit a different file Y on device B. Sync from device A.
   - Expected: file X appears in the conflict UI; file Y is pushed cleanly; resolving the conflict applies without errors.
