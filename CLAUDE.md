# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Jackdaw is an Obsidian plugin that provides manual, bidirectional, one-button synchronization between an Obsidian vault and a single GitHub repository branch. It uses the GitHub REST API exclusively — no `git` binary, no `isomorphic-git`. It runs on Obsidian desktop and Obsidian iOS. Android is explicitly not supported in v1.

The primary use case is enabling agentic AI tools (like Claude Code) to edit vault notes by using GitHub as transport: user clicks Sync → agent edits repo → user clicks Sync again.

The full design specification is at `docs/design-specification.md` and is the authoritative reference.

## Project status

The project is in initial development (Phase 0 not yet started). The design spec is complete; no source code exists yet. This CLAUDE.md will be updated with build/test commands in Phase 0.

## Development workflow

See `docs/workflow.md` for the full workflow. See `docs/human-interactions.md` for every human approval gate. ADRs live in `docs/adr/`. Planning session summaries live in `docs/sessions/`.

## Architecture

Six modules (see §3 of the design spec for the ASCII diagram):

- **`src/github-client.ts`** — Thin wrapper around Obsidian's `requestUrl`. Handles auth, rate-limit headers, exponential backoff on 429, base64 encode/decode. No Octokit (bundle weight). Must use `requestUrl`, not `fetch` — `fetch` fails CORS in the renderer.
- **`src/state-store.ts`** — Owns `sync-state.json` (paths → SHA-256 hashes + blob SHAs + last commit SHA). Atomic writes via temp-file-and-rename. This is the plugin's own index, not git's index.
- **`src/sync-engine.ts`** — State machine for a single sync invocation. Pre-flight → local scan → remote tree fetch → classify → conflict resolution → pull → push → save state. Max 2 retries on ref-update race (422 fast-forward failure).
- **`src/logger.ts`** — JSONL log to `.obsidian/plugins/<id>/sync.log`. Never logs PAT or file contents. Rotates at 1 MB.
- **`src/ui/`** — Settings tab, ribbon icon, status bar, conflict resolution modal, first-sync modal.
- **`src/main.ts`** — Plugin entry point, registers ribbon icon and command, handles Android detection.

## Key design constraints

These are hard constraints that bind every implementation decision:

- **No `fetch`** — use `requestUrl({ url, method, headers, body, throw: false })`. This is the only HTTP API that works on iOS.
- **No streaming** — `requestUrl` buffers full responses. All file I/O is whole-file.
- **Vault I/O** — always through `app.vault` (preferred) and `app.vault.adapter` (for dotfiles outside `getFiles()` reach). Never direct filesystem access.
- **Web Crypto only** — SHA-256 via `crypto.subtle.digest`. SHA-1 (for git blob SHA computation) via `crypto.subtle.digest('SHA-1', ...)`.
- **Self-exclusion** — the plugin's `data.json`, `sync-state.json`, and `sync.log` must be hard-excluded from sync, always, regardless of user settings.

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

Unit tests cover the classifier matrix (every cell in §5.5), hash utilities, state store atomicity, and GitHub client error paths. Integration tests run against a real GitHub repo on a CI-owned account with fresh branches per run. Manual iOS testing (§11.3) is the single most important derisking step.
