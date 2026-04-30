# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Jackdaw is an Obsidian plugin that provides manual, bidirectional, one-button synchronization between an Obsidian vault and a single GitHub repository branch. It uses the GitHub REST API exclusively — no `git` binary, no `isomorphic-git`. It runs on Obsidian desktop and Obsidian iOS. Android is explicitly not supported in v1.

The primary use case is enabling agentic AI tools (like Claude Code) to edit vault notes by using GitHub as transport: user clicks Sync → agent edits repo → user clicks Sync again.

The full design specification is at `docs/design-specification.md` and is the authoritative reference.

## Project status

Phase 0 (scaffold) is complete. Phase 1 (core libs) is complete. Phase 2 (sync engine) is complete. Phase 3 (UI) is complete. Phase 4 (UI conflicts) is complete. Phase 5 (BRAT release) is next.

## Build commands

```sh
npm install       # install dependencies
npm run build     # production build → main.js
npm run dev       # watch mode (rebuilds on save)
npm run typecheck # TypeScript type check without emitting
npm run lint      # ESLint over src/
```

## Loading in Obsidian

1. Clone (or symlink) this repo into `<your-vault>/.obsidian/plugins/jackdaw/`.
2. Run `npm install && npm run build` to produce `main.js`.
3. In Obsidian → Settings → Community plugins, disable Safe mode and enable **Jackdaw**.
4. During development, run `npm run dev` for watch mode, then use **Reload app without saving** (Ctrl/Cmd+P) after each rebuild.

## Development workflow

See `docs/workflow.md` for the full workflow. See `docs/testing.md` for manual testing steps. ADRs live in `docs/adr/`. Planning session summaries live in `docs/sessions/`.

## Issue number shorthand

If the session opens with a message that is solely an issue number (e.g. `#40` or `40`), treat it as an instruction to implement that issue:

1. Fetch the issue from `jimcasey/jackdaw` using the GitHub MCP tools.
2. Read the issue body and any linked design-spec sections to understand the requirements.
3. Update local `main` from the remote (`git checkout main && git pull --ff-only origin main`) so the new branch starts from the latest base. If `main` is already checked out, just pull.
4. Create (or check out) the appropriate feature branch following the repo's branch-naming convention, branching from the freshly-updated `main`.
5. Implement the issue — writing code, tests, and any doc updates required.
6. Commit and push to the feature branch.
7. Open a pull request following the repo's PR conventions (short title, body with summary + test plan, `Closes #N` or `Fixes #N` in the body so the issue auto-closes on merge).

## Pull requests

- Keep PR titles short and descriptive; do not include issue references in the title.
- **Always** include `Closes #N` (or `Fixes #N`) in the PR description body — never in the title. GitHub auto-closes the linked issue on squash-merge only when the keyword appears in the description. This is required for every PR that resolves an issue; do not skip it.

## Architecture

Core modules (see §3 of the design spec for the ASCII diagram):

- **`src/github-client.ts`** — Thin wrapper around Obsidian's `requestUrl`. Handles auth, rate-limit headers, exponential backoff on 429/5xx, base64 encode/decode (`encodeBase64Chunked`). Exports seven typed error classes (`GHAuthError`, `GHNotFoundError`, `GHEmptyRepoError`, `GHRateLimitError`, `GHFastForwardError`, `GHNetworkError`, `GHServerError`). `getBranch()` probes `git/refs/heads` to distinguish empty-repo from missing-repo on 404. No Octokit. Must use `requestUrl`, not `fetch` — `fetch` fails CORS in the renderer.
- **`src/state-store.ts`** — Owns `sync-state.json` (paths → SHA-256 hashes + blob SHAs + last commit SHA). Atomic writes via temp-file-and-rename. Uses a `StateAdapter` interface (not `DataAdapter` directly) for testability. This is the plugin's own index, not git's index.
- **`src/hash.ts`** — `sha256(bytes)` and `gitBlobSha1(bytes)` utilities. Both use `crypto.subtle.digest`. `gitBlobSha1` is used at first-sync to identify identical files without downloading them.
- **`src/logger.ts`** — JSONL log to `.obsidian/plugins/<id>/sync.log`. Never logs PAT or file contents. Rotates at 1 MB. PAT scrubbed from all log lines via string replacement and a header regex.
- **`src/settings.ts`** — `Settings` interface and `DEFAULT_SETTINGS` constant. Covers PAT, repo, conflict policy, per-file size limit, device name, include-obsidian-config, exclude patterns, verbose logging.
- **`src/constants.ts`** — `PLUGIN_ID`, `SELF_EXCLUDED_PATHS` (hard-excludes `data.json`, `sync-state.json`, `.tmp`, `sync.log`, `.log.1`), and `BINARY_EXTENSIONS` set.
- **`src/sync-engine-types.ts`** — Shared type contract for the sync engine. `LocalChange`, `RemoteChange`, `ClassifiedPath` (action: `'pull' | 'push' | 'conflict' | 'no-op' | 'state-refresh'`), `ConflictItem` (extends `ClassifiedPath` with `isBinary`, `localSize`, `remoteSize`, `remoteBlobSha` so resolvers can render diffs without re-querying the engine), `VaultAdapter`, `ConflictResolver`, `FirstSyncResolver`, `PolicyBasedResolver`, `PolicyAwareConflictResolver`, `PolicyAwareFirstSyncResolver`, `SyncNeedsUIError`, `SyncStateInconsistencyError`. The `PolicyAware*` wrappers branch between modal and `PolicyBasedResolver` based on the live `conflictPolicy` setting; injected by `main.ts` so `SyncEngine` is policy-agnostic and always calls `this.conflicts.resolve()`.
- **`src/classifier.ts`** — Pure `classify()` function; full §5.5 4×4 matrix; §4.4 staleness detection (emits `'state-refresh'` when local blob SHA matches remote despite state mismatch).
- **`src/file-scanner.ts`** — `FileScanner`; `.gitignore` parse + glob compiler; `.git/` directory-level hard-exclusion.
- **`src/local-change-set.ts`** — `buildLocalChangeSet()`; delegates to `FileScanner`; computes SHA-256; identifies deletions from state.
- **`src/remote-change-set.ts`** — `buildRemoteChangeSet()`; recursive tree fetch; BFS truncated-tree fallback.
- **`src/apply-pull.ts`** — `applyPull()`; size-limit skip; binary/text branch; remote-deleted hash guard.
- **`src/apply-push.ts`** — `applyPush()` + `formatCommitMessage()`; serial blob creation; 50-file truncation in commit message.
- **`src/first-sync.ts`** — `buildLocalInventory()` + `buildFirstSyncSummary()`; `gitBlobSha1()` for identical-file detection without download.
- **`src/sync-engine.ts`** — `SyncEngine` orchestrator. Pre-flight → local scan → remote tree fetch → classify → conflict resolution → pull → push → save state. Max 2 retries on ref-update race (422 fast-forward failure).
- **`src/sync-notice.ts`** — `formatSyncOutcome()`; maps `SyncResult` to `{ toasts, statusBar }` for `main.ts` to act on. Keeps notice logic testable without Obsidian dependency.
- **`src/obsidian-vault-adapter.ts`** — Production `VaultAdapter`; bridges sync engine to `app.vault` / `app.vault.adapter`. Uses duck-typed `isTFile()` guard (not `instanceof`) to stay testable in pure Node.
- **`src/obsidian-state-adapter.ts`** — Production `StateAdapter`; thin passthrough to `app.vault.adapter` for `StateStore`.
- **`src/ui/settings-tab.ts`** — `JackdawSettingsTab`; Connection, Sync behavior, Inclusion, Diagnostics sections; `SyncLogModal` (with Copy button + log path hint); `ResetSyncStateModal`.
- **`src/ui/ribbon.ts`** — `RibbonIcon`; `setSyncing()` / `setIdle()` CSS class toggle on the ribbon element.
- **`src/ui/status-bar.ts`** — `StatusBar`; `setIdle()`, `setSyncing()`, `setError()`; desktop-only.
- **`src/ui/diff.ts`** — `computeLineDiff()` wraps the `diff` npm package's `diffLines`. Returns `DiffLine[]` (`{ kind: 'context'|'add'|'remove', text, localLineNumber?, remoteLineNumber? }`) so the row renderer stays a dumb function of structured data. Pure Node, no DOM.
- **`src/ui/modals/conflict-row.ts`** — `createConflictRow()` factory returning `{ el, setResolution, setExpanded, setContent }`. Same row component is used by both modals. Content has four states: `loading`, `error`, `binary` (renders byte-count summary per §8.3), `text` (renders `DiffLine[]`).
- **`src/ui/modals/virtualized-list.ts`** — Pure `computeVirtualWindow()` taking `{scrollTop, viewportHeight, itemCount, getItemHeight, overscan}` and returning `{startIndex, endIndex, totalHeight, offsetY}`. Variable-height rows via `getItemHeight`; default overscan = 3.
- **`src/ui/modals/conflict-resolution-modal.ts`** — `ConflictResolutionModal extends Modal implements ConflictResolver`. Rows are collapsed by default; expanding triggers lazy `getBlob()` + local read + `computeLineDiff()`. In-modal `Map<path, ContentState>` cache survives unmount when rows scroll out. `Apply` disabled until every conflict has a resolution.
- **`src/ui/modals/first-sync-modal.ts`** — `FirstSyncModal extends Modal implements FirstSyncResolver`. Same row + virtualized-list components as the conflict modal, plus a summary block (counts of local-only / remote-only / identical / conflicts) and a confirmation checkbox per §8.4. `Apply` disabled until checkbox is checked **and** every conflict resolved.
- **`src/main.ts`** — `JackdawPlugin` entry point. Instantiates and wires all components. Wraps `ConflictResolutionModal` and `FirstSyncModal` in `PolicyAwareConflictResolver` / `PolicyAwareFirstSyncResolver` so the live `conflictPolicy` setting decides between modal UI and `PolicyBasedResolver` on each sync. `runSync()` with `isRunningSync` guard. `handleSyncResult()` delegates to `sync-notice.ts`. Android short-circuit.

## Key design constraints

These are hard constraints that bind every implementation decision:

- **No `fetch`** — use `requestUrl({ url, method, headers, body, throw: false })`. This is the only HTTP API that works on iOS.
- **No streaming** — `requestUrl` buffers full responses. All file I/O is whole-file.
- **Vault I/O** — always through `app.vault` (preferred) and `app.vault.adapter` (for dotfiles outside `getFiles()` reach). Never direct filesystem access.
- **Web Crypto only** — SHA-256 via `crypto.subtle.digest`. SHA-1 (for git blob SHA computation) via `crypto.subtle.digest('SHA-1', ...)`.
- **Self-exclusion** — the plugin's `data.json`, `sync-state.json`, `sync-state.json.tmp`, `sync.log`, and `sync.log.1` must be hard-excluded from sync, always, regardless of user settings. These are listed in `SELF_EXCLUDED_PATHS` in `src/constants.ts`.

## Sync algorithm

The classifier at §5.5 of the design spec is the core logic. Every implementation decision flows from this 4×4 matrix of local × remote change states. Read it before touching `sync-engine.ts`.

Pull happens before push (§5.7). This is intentional: if push fails, the vault has the remote state, which is recoverable from GitHub.

## State model

```ts
interface SyncedFileRecord {
  path: string;        // vault-relative, forward-slash normalized
  blobSha: string;     // GitHub blob SHA (SHA-1 of "blob N\0content")
  contentHash: string; // SHA-256 of local bytes at last sync
  size: number;
  isBinary: boolean;
}

interface SyncState {
  schemaVersion: 1;
  lastSyncCommitSha: string | null;  // null before first sync
  lastSyncAt: string;                 // ISO 8601
  files: Record<string, SyncedFileRecord>;
}
```

Absence of `sync-state.json` triggers the first-sync flow (§7), which uses `gitBlobSha1()` to identify identical files without downloading them.

## Obsidian Sync coexistence

`sync-state.json` propagates between devices via Obsidian Sync, which is mostly helpful but creates a staleness edge case: if device B syncs before Obsidian Sync delivers device A's updated state, B will see an older `lastSyncCommitSha`. Detect this by checking if local content hash matches remote blob hash despite both differing from state — treat as no-op, update state silently. See §4.4 of the design spec.

## Testing

Test files live in `tests/` (not `src/`). Unit tests cover the classifier matrix (every cell in §5.5), hash utilities, state store atomicity, and GitHub client error paths. Integration tests run against a real GitHub repo on a CI-owned account with fresh branches per run. Manual iOS testing (§11.3) is the single most important derisking step.
