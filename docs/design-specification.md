# Obsidian ↔ GitHub Sync Plugin — Design Specification

**Status:** Draft v1
**Companion doc:** `obsidian-github-sync-feasibility.md`
**Distribution:** BRAT beta

---

## 1. Purpose and scope

### 1.1 What this plugin does

A manual, bidirectional, one-button synchronizer between an Obsidian vault and a single branch of a single GitHub repository. The plugin uses the GitHub REST API exclusively — no `git` binary, no `isomorphic-git`. It runs on Obsidian desktop and Obsidian iOS.

### 1.2 What this plugin does *not* do

- No background sync, no interval sync, no event-driven sync. Every sync is initiated by the user.
- No git semantics beyond "make a commit on a branch": no branch switching, no merging across branches, no rebasing, no cherry-pick, no tag management, no history browsing inside Obsidian.
- No support for Git hosts other than GitHub.
- No replacement of, or competition with, Obsidian Sync. The plugin is designed to coexist with Obsidian Sync running on the same vault.
- Android is not supported in v1. The plugin should not crash if loaded on Android, but features may be unreliable there and the manifest will mark Android as unsupported in the README. (See §10.)

### 1.3 Primary use case

The user runs Claude Code (or similar agentic coding tools) against the vault on a development machine, using GitHub as the transport between Obsidian and the agent. Workflow:

1. User captures quick notes throughout the day across iPhone, iPad, and desktop. Obsidian Sync replicates these between devices in near-real-time.
2. When ready to organize, the user opens Obsidian on their primary device and clicks the sync button — vault is pushed to GitHub.
3. User runs Claude Code against the GitHub repository, with prompts like "collate today's quick notes into the relevant subject files" or "summarize this week's research notes on X." Claude Code commits its changes back to the repo.
4. User clicks the sync button again in Obsidian — Claude's changes are pulled into the vault. Obsidian Sync then propagates those changes to all other devices.

Vault profile this is optimized for: text-heavy, a few thousand notes, few binary attachments, individual files small (<1 MB typical, <25 MB hard ceiling).

---

## 2. Design constraints recap

These come from the feasibility analysis and bind every decision below.

- **Mobile API surface:** No Node, no native binaries, no `fetch` (use `requestUrl`), no streaming response bodies, no background execution.
- **Vault adapter:** All I/O through `app.vault` and `app.vault.adapter`. Whole files only — no chunked reads.
- **GitHub API:** 5,000 req/hr authenticated, 100 concurrent cap, 7 MB / 100,000-entry tree recursion cap, 100 MB per blob hard cap, secondary rate limits on rapid creation.
- **Obsidian Sync coexistence:** The plugin's own state files live inside `.obsidian/plugins/<id>/`, which Obsidian Sync replicates. State must be designed for concurrent observation and (rare) concurrent modification from multiple devices.
- **Plugin manifest:** `isDesktopOnly: false`, `minAppVersion` set to a recent enough Obsidian to expose `requestUrl` and `appendBinary`.

---

## 3. High-level architecture

```
┌─────────────────────────────────────────┐
│            Obsidian Plugin              │
│                                         │
│   ┌────────────┐    ┌──────────────┐    │
│   │  Sync      │◄──►│  GitHub      │    │
│   │  Engine    │    │  REST Client │    │
│   └─────┬──────┘    └──────┬───────┘    │
│         │                  │            │
│   ┌─────▼──────┐           │            │
│   │ State      │           │            │
│   │ Store      │           │            │
│   └─────┬──────┘           │            │
│         │                  │            │
│   ┌─────▼──────────────────▼────────┐   │
│   │   Obsidian Vault API            │   │
│   └────────────┬────────────────────┘   │
│                │                        │
│         ┌──────▼──────┐                 │
│         │  Logger     │  (local file)   │
│         └─────────────┘                 │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │   UI: Settings, Status, Diff    │   │
│   └─────────────────────────────────┘   │
└─────────────────────────────────────────┘
                 │
                 │ HTTPS (requestUrl)
                 ▼
         ┌────────────────┐
         │  GitHub API    │
         └────────────────┘
```

Modules:

- **GitHub REST Client** — thin wrapper around `requestUrl`. Handles auth header injection, rate-limit-header parsing, exponential backoff on 429/secondary-limit, base64 encode/decode. No external SDK (avoid Octokit's bundle weight).
- **State Store** — owns `sync-state.json`, the file content cache (paths → hashes), and atomic writes.
- **Sync Engine** — the state machine that drives a single sync invocation. Does not own threads/timers; takes one input (button press), produces one output (success or actionable error).
- **Vault API surface** — read/write/delete/rename through `app.vault` (preferred) and `app.vault.adapter` (for files outside `getFiles()` reach, like dotfiles inside `.obsidian/`).
- **Logger** — writes structured log entries to `.obsidian/plugins/<id>/sync.log`. Never logs file contents, never logs the PAT.
- **UI** — a settings tab, a ribbon icon and command for "Sync now," a status bar item showing last-sync time, and a modal-based conflict resolution view.

---

## 4. State model

### 4.1 The synced-state record

For every file the plugin manages, it records a tuple:

```ts
interface SyncedFileRecord {
  path: string;             // vault-relative, normalized, forward-slash
  blobSha: string;          // last known remote blob SHA (40 hex chars)
  contentHash: string;      // SHA-256 of local bytes at last sync
  size: number;             // bytes
  isBinary: boolean;        // determines blob encoding on push
}
```

The "last known synced state" is the union of all such records, plus the head commit SHA the plugin last observed:

```ts
interface SyncState {
  schemaVersion: 1;
  lastSyncCommitSha: string | null;         // null before first sync
  lastSyncAt: string;                       // ISO 8601
  files: Record<string, SyncedFileRecord>;  // keyed by path
}
```

This is the index. It is *not* git's index — it lives in the plugin's own data, not in the vault tree, and it is the only authority on "what does the plugin think is in sync."

### 4.2 Storage location and format

**File:** `.obsidian/plugins/<plugin-id>/sync-state.json`
**Format:** Minified JSON. Pretty-printed during development, minified in release.
**Atomicity:** Every write goes via the temp-file-and-rename pattern:
1. Write JSON to `sync-state.json.tmp`
2. `adapter.rename('sync-state.json.tmp', 'sync-state.json')` — atomic on iOS and on every desktop OS we target.
3. On startup, if `sync-state.json.tmp` exists and `sync-state.json` does not, recover from the tmp file (treat as the most recent state).

Plugin settings (PAT, repo, branch, exclude patterns, conflict policy) live in the standard `data.json`, separate from `sync-state.json`. This separation matters for the Obsidian Sync interaction (see §4.4).

### 4.3 Content hashing

SHA-256 of the raw bytes. Computed via Web Crypto (`crypto.subtle.digest`), which is available in Obsidian's webview on both desktop and mobile.

For text files, hash the bytes as-is — do *not* normalize line endings before hashing, because doing so would mask real changes that GitHub would see. (A consequence: a file synced from Windows to GitHub and back may show as "modified" if Obsidian Sync doesn't preserve line endings. In practice Obsidian doesn't munge line endings, but this is worth noting in the test plan.)

For binary files (detected by extension allowlist: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.pdf`, `.mp3`, `.mp4`, `.mov`, `.zip`, `.icloud`, etc., plus a sniff check on first bytes), same SHA-256 of raw bytes.

### 4.4 Coexistence with Obsidian Sync

This is the most subtle part of the design.

**The fact:** Obsidian Sync replicates the entire vault, including `.obsidian/plugins/<plugin-id>/data.json` and `sync-state.json`. So both files appear on every device the user has Obsidian Sync configured for.

**Implications, in order of interestingness:**

1. **The PAT lives on every Obsidian Sync device.** That's by design — the user wants to sync from any of them. Obsidian Sync is end-to-end encrypted, so the PAT is safe in transit, but the user should understand this. Document it in the settings tab. Recommend a fine-grained PAT scoped to one repo with an expiry.

2. **`sync-state.json` propagates between devices automatically.** This is mostly *helpful*: when the user syncs from device A, the resulting `sync-state.json` flows to device B via Obsidian Sync, so device B already knows the latest commit SHA before it tries to sync. This avoids a class of false conflicts.

3. **But Obsidian Sync is eventually consistent.** If the user syncs on device A and then immediately syncs on device B before Obsidian Sync has caught up, device B will see a stale `sync-state.json` and will think the remote is at an older commit than it actually is. The plugin must detect this and recover gracefully:
   - On every sync, after fetching the remote head SHA, compare against `sync-state.lastSyncCommitSha`.
   - If the remote is *ahead* of what state thinks it is, that's normal and is handled by the pull phase.
   - If the local *content* claims to differ from `sync-state` for a file but the remote blob also differs from `sync-state` for the same file, *and* the local content matches the remote content (same hash), this is the staleness pattern. Treat as a no-op for that file and update state silently.

4. **Two devices, simultaneous user-initiated sync.** Possible but rare given manual-only triggering. The plugin handles this with a compare-and-swap on the GitHub ref update (`PATCH /git/refs/heads/<branch>` with the expected current SHA). If the ref-update fails because the SHA moved, the plugin retries the entire sync from scratch — re-fetches the remote tree, re-merges, re-pushes. Maximum two retries before surfacing an error.

5. **Self-exclusion: never push our own data files.** The plugin's `data.json` (containing the PAT) and `sync-state.json` and `sync.log` must be hard-excluded from sync, regardless of user settings. They live in the vault but are not part of the synced corpus. This is implemented in the file walker, not in the user-facing exclude list.

6. **Optional `.obsidian` sync.** The user already has Obsidian Sync handling settings replication between their devices, so syncing `.obsidian` to GitHub is mostly redundant. Default this OFF. If the user opts in, exclude our own plugin folder regardless.

### 4.5 First-sync state

`sync-state.json` does not exist before the first sync. The plugin treats absence of the file as "first sync" and follows the mass-conflict flow (§7).

---

## 5. The sync algorithm

A single user-initiated sync executes the following state machine. Each step is documented with its failure modes.

### 5.1 Pre-flight

1. **Validate settings.** PAT, owner, repo, branch all set. If not, show a settings prompt and abort.
2. **Acquire the sync lock.** An in-process flag (`isSyncing: boolean`) plus a UI lockout. If a sync is already running, the button is disabled. No filesystem-level lock — Obsidian doesn't expose one, and cross-device locking would require a server we don't have.
3. **Load `sync-state.json`** (or treat as first sync if absent).
4. **Fetch remote head.** `GET /repos/{owner}/{repo}/branches/{branch}`. From the response, capture `commit.sha` and `commit.commit.tree.sha`.

### 5.2 First-sync branch

If `sync-state.json` does not exist, jump to §7 (mass-conflict flow). Do not proceed with the normal algorithm.

### 5.3 Build the local change set

Before walking, build the exclusion filter:
1. Start with the plugin's hard-excluded paths: `data.json`, `sync-state.json`, `sync-state.json.tmp`, `sync.log`, `sync.log.1` (all under `.obsidian/plugins/<our-id>/`).
2. If a `.gitignore` file exists at the vault root, read it and parse its positive patterns (lines that are not blank, not comments, and do not begin with `!`) into the exclusion list. Negation lines (`!pattern`) are silently ignored for v1.
3. Append user-configured exclude patterns from settings.

Walk the vault:
- `app.vault.getFiles()` for everything Obsidian indexes (markdown, canvases, attachments, etc.).
- Adapter walk through `.obsidian` if and only if the user has opted into config sync, with hard exclusion of `.obsidian/plugins/<our-id>/`.
- When descending directories via the adapter walk, **never descend into `.git/`** — skip it at the directory level, not the file level. This is a hard exclusion regardless of user settings (see ADR 002).
- Apply the exclusion filter (glob-matched against vault-relative paths) to all candidate files.

For each candidate file:
- Read bytes. For text files, `vault.read(file)`. For binaries, `vault.readBinary(file)`. (Choice of API is determined by extension, not by guessing.)
- Compute SHA-256.
- Compare against `sync-state.files[path]`:
  - Not in state → `local-added`.
  - In state, hash differs → `local-modified`.
  - In state, hash matches → `local-unchanged`.

Identify deletions:
- Any path in `sync-state.files` that no longer exists in the vault → `local-deleted`.

### 5.4 Build the remote change set

`GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1`.

Check `truncated`:
- If `false`, walk the response normally.
- If `true`, fall back to per-directory walks: `GET /git/trees/{sha}` for each subtree, recursively. (This is rare for v1's expected vault sizes; implement it but don't optimize.)

For each tree entry where `type === 'blob'`:
- Compare against `sync-state.files[path]`:
  - Not in state → `remote-added`.
  - In state, `blobSha` differs → `remote-modified`.
  - In state, `blobSha` matches → `remote-unchanged`.

Remote deletions:
- Any path in `sync-state.files` that's no longer in the remote tree → `remote-deleted`.

### 5.5 Classify

For each path, the cross-product of `{none, added, modified, deleted}` × `{none, added, modified, deleted}` gives 16 cells. Most collapse:

| Local \ Remote | unchanged | added | modified | deleted |
|---|---|---|---|---|
| **unchanged** | no-op | apply remote (pull) | apply remote (pull) | apply remote (pull) |
| **added** | apply local (push) | **conflict** | impossible* | impossible* |
| **modified** | apply local (push) | impossible* | **conflict** | **conflict** |
| **deleted** | apply local (push) | impossible* | **conflict** | no-op |

*Impossible because if a path was in `sync-state`, it can't be `remote-added` (it was already there); and if it wasn't in state, `local-modified` and `local-deleted` aren't possible classifications.

Conflicts are the union of:
- `local-added` × `remote-added` with non-matching hashes (added on both sides with different content)
- `local-modified` × `remote-modified` with non-matching hashes
- `local-modified` × `remote-deleted`
- `local-deleted` × `remote-modified`

For added-on-both-sides where hashes match: not a conflict. Just update state.
For modified-on-both-sides where hashes match: not a conflict. Just update state. (See §4.4 staleness case.)

### 5.6 Resolve conflicts

If the conflict set is non-empty:
- Open the conflict resolution modal (§8.3).
- The modal yields, for each conflicted path, one of: `keep-local`, `keep-remote`, `cancel-sync`.
- If user cancels, abort the sync. State is unchanged. No partial commit.
- If conflict policy in settings is `always-prefer-local` or `always-prefer-remote`, skip the modal.

After resolution, conflicted paths are merged into the appropriate side:
- `keep-local` → treated as a local push (overwrite remote).
- `keep-remote` → treated as a remote pull (overwrite local).

### 5.7 Apply the pull

Apply `remote → local` changes first. (Reasoning: if anything goes wrong during apply, the local vault gets the remote state, which is recoverable from GitHub. The opposite order risks pushing garbage.)

For each path being pulled:
- If `remote-added` or `remote-modified`: `GET /git/blobs/{sha}` with `Accept: application/vnd.github.raw` (avoids the base64 round-trip for files > 1 MB). For very large files, check size from the tree entry first against the user's per-file size limit (§6.4) and skip with a warning if exceeded.
- Write to vault: `vault.modify(file, content)` or `vault.create(path, content)` for text; `vault.modifyBinary` / `vault.createBinary` for binary. These trigger Obsidian's own change events, which Obsidian Sync will pick up.
- If `remote-deleted`: `vault.delete(file)` — but only if the file currently matches the synced-state hash (defense-in-depth against deleting work that was modified locally without us noticing). If hash mismatch, treat as a conflict that should have been caught earlier; bail and report.

After all pulls succeed, update `sync-state.files` for those paths.

### 5.8 Apply the push

If, after the pull, no `local-*` changes remain, skip the push entirely and update `lastSyncCommitSha` to the current remote head.

Otherwise, build a single commit:

1. **Create blobs** for all `local-added` and `local-modified` files. `POST /git/blobs` with `{content, encoding}` where encoding is `utf-8` for text and `base64` for binary. Issue these serially, not concurrently — the secondary rate limit is forgiving of serial requests and unforgiving of concurrent ones. (For vaults with many small changes, this can be the slowest step. Acceptable for v1.)

2. **Create a tree.** `POST /git/trees` with:
   - `base_tree`: the remote tree SHA we fetched at the start (or, if we just pulled changes, the resulting tree SHA, but it's simpler and equally correct to use the original and let the tree API merge).
   - `tree`: array of entries, one per changed path:
     - Add/modify: `{path, mode: '100644', type: 'blob', sha: <new_blob_sha>}`
     - Delete: `{path, mode: '100644', type: 'blob', sha: null}`

3. **Create a commit.** `POST /git/commits` with:
   - `message`: a generated message (§5.9).
   - `tree`: the new tree SHA.
   - `parents`: `[<remote_head_sha_at_start_of_sync>]`.

4. **Update the ref.** `PATCH /git/refs/heads/{branch}` with `{sha: <new_commit_sha>, force: false}`.
   - On success: update `sync-state` to reflect the new commit and updated file SHAs. Save state.
   - On 422 "Update is not a fast forward": this means another device pushed while we were working. Restart the entire sync from §5.1 (max 2 retries; surface error if still failing).

### 5.9 Commit message format

```
Obsidian sync from <device-name> at <ISO-timestamp>

<N> file(s) changed:
+ path/to/added.md
~ path/to/modified.md
- path/to/deleted.md
```

`<device-name>` is configurable in settings, defaulting to the OS hostname on desktop and a user-supplied label on mobile (since iOS doesn't reliably expose a useful name to webview JS). If the file list exceeds 50 entries, truncate with `... and N more`.

### 5.10 Post-sync

- Update status bar with last-sync time.
- Write a structured log entry (`{ts, durationMs, filesAdded, filesModified, filesDeleted, conflictsResolved, commitSha}`).
- Notice toast: "Synced N changes."

---

## 6. GitHub REST client

### 6.1 Surface

```ts
class GitHubClient {
  constructor(
    getPat: () => string,    // called on every request so settings changes take effect immediately
    getOwner: () => string,
    getRepo: () => string,
    version: string,
    logger?: GHLogger | null,
    sleep?: (ms: number) => Promise<void>,  // injectable for tests
  )

  getBranch(owner, repo, branch): Promise<{commitSha, treeSha}>
  getTree(owner, repo, treeSha, recursive: boolean): Promise<TreeResponse>
  getBlob(owner, repo, blobSha): Promise<ArrayBuffer>      // uses raw media type
  createBlob(owner, repo, content: ArrayBuffer, isBinary: boolean): Promise<{sha}>
  createTree(owner, repo, baseTreeSha, entries: TreeEntry[]): Promise<{sha}>
  createCommit(owner, repo, message, treeSha, parentSha): Promise<{sha}>
  updateRef(owner, repo, branch, commitSha): Promise<void>  // throws GHFastForwardError on 422
}

// Minimal logger interface the client depends on (only needs warn for rate-limit warnings).
interface GHLogger {
  warn(event: string, fields?: Record<string, unknown>): Promise<void>;
}

// Error taxonomy thrown by GitHubClient methods:
class GHAuthError extends Error {}         // 401 — bad/expired PAT
class GHNotFoundError extends Error {}     // 404 — missing resource or insufficient permissions
class GHRateLimitError extends Error {     // rate limit exhausted or secondary-limit retries exceeded
  retryAfterMs: number;
}
class GHFastForwardError extends Error {}  // 422 on any endpoint (in practice: updateRef only)
class GHNetworkError extends Error {}      // transport-level failure after one retry
class GHServerError extends Error {        // 5xx or other unexpected status
  status: number;
}

// Utility exported alongside the client:
function encodeBase64Chunked(buffer: ArrayBuffer): string;  // chunked btoa to avoid stack overflow on large files
```

### 6.2 Authentication

All requests include `Authorization: Bearer <PAT>`. PAT is read from settings on each call (not cached as a constant), so settings changes take effect immediately.

### 6.3 Headers

- `Accept: application/vnd.github+json` (default) or `application/vnd.github.raw` (blob fetch).
- `X-GitHub-Api-Version: 2022-11-28` (pin to avoid surprises).
- `User-Agent: obsidian-<plugin-id>/<version>`. Obsidian's `requestUrl` may strip or override this — verify in the test plan.

### 6.4 Limits, retries, errors

- **Per-file size limit:** Configurable, default 25 MB. Files exceeding this are skipped with a notice listing the offenders. (Backed by feasibility-doc finding that `requestUrl` buffers full responses and that Android `writeBinary` has issues at large sizes; we apply the limit even on iOS-only for symmetry.)
- **Tree truncation:** If `truncated: true`, fall back to per-subtree walk.
- **Rate limits:** Inspect `X-RateLimit-Remaining`. Below 100, log a warning. At 0, abort with the reset time in the error message.
- **Secondary rate limits (429 or 403 with `retry-after`):** Honor `Retry-After`, exponential backoff with jitter, max 3 retries.
- **Network errors:** Single retry after 2s. Surface the underlying error message.
- **Auth failure (401):** Abort immediately with a "Check your token" error; never retry, never log the token.
- **Not found (404):** Could be missing repo, missing branch, or PAT lacks permission. The error message should be honest about ambiguity.
- **Conflict (422):** Throw `GHFastForwardError`. In practice only `updateRef` receives a 422 from GitHub; the engine handles retry. Any other operation receiving a 422 will also surface as `GHFastForwardError`.
- **Server errors (5xx):** Exponential backoff with jitter, max 3 retries. Throws `GHServerError` with the status code if retries are exhausted.

### 6.5 Implementation notes

Use Obsidian's `requestUrl({ url, method, headers, body, throw: false })`. Do not use `fetch` — it will fail CORS in the renderer. `throw: false` lets the client read non-2xx responses to extract structured error info.

For binary blob upload, base64-encode the `ArrayBuffer` before sending. There is no streaming upload. (Browser `btoa` chokes on large strings; use a chunked encoder.)

---

## 7. First-sync flow (mass-conflict)

The plugin treats the absence of `sync-state.json` as the trigger for first-sync. Algorithm:

1. **Fetch remote tree** (the full recursive tree as in §5.4).
2. **Build local file inventory** with hashes (as in §5.3).
3. **Compute the cross-classification:**
   - Path in local only → `local-only`
   - Path in remote only → `remote-only`
   - Path in both, hashes match (after fetching and comparing remote blob hash via `git hash-object`-equivalent calculation, see below) → `identical`
   - Path in both, hashes differ → `conflict`
4. **Open the first-sync modal** (§8.4). It shows summary counts (e.g. "237 only-local, 412 only-remote, 89 identical, 18 conflicts") and lists the conflicts.
5. **User resolves each conflict** (`keep-local` / `keep-remote`) or cancels.
6. After resolution, the operation proceeds as a normal sync: pull all `remote-only` and `keep-remote` files, push all `local-only` and `keep-local` files. Identical files just go into `sync-state` directly.
7. After completion, `sync-state.json` is written for the first time.

**Note on "git hash-object equivalent":** GitHub's blob SHA is `SHA1("blob " + size + "\0" + content)`, not a SHA-256 of bytes. To compare a local file to a remote blob without downloading the blob, the plugin must compute the git blob SHA-1 locally. This is straightforward via Web Crypto's SHA-1 API. Implement as a utility:

```ts
async function gitBlobSha1(bytes: ArrayBuffer): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const combined = new Uint8Array(header.byteLength + bytes.byteLength);
  combined.set(header, 0);
  combined.set(new Uint8Array(bytes), header.byteLength);
  const digest = await crypto.subtle.digest('SHA-1', combined);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
```

This is used at first-sync to identify identical files without downloading them, and at no other time. (During normal sync, `sync-state.files[path].blobSha` is the source of truth and we don't recompute.)

---

## 8. UI

### 8.1 Settings tab

Sections:

**Connection**
- Repository owner (text)
- Repository name (text)
- Branch (text, default `main`)
- Personal access token (password input)
- "Test connection" button — calls `getBranch` and reports success/failure.

**Sync behavior**
- Conflict policy (dropdown): `Always ask`, `Always prefer local`, `Always prefer remote`. Default: `Always ask`.
- Per-file size limit (number, MB). Default: 25.
- Device name for commit messages (text, default: hostname/auto).

**Inclusion**
- Include `.obsidian` configs (toggle, default off, with warning text about the security implications and noting that the plugin's own data is always excluded).
- Exclude patterns (textarea, one glob per line). Defaults include common `.gitignore`-style entries: `*.tmp`, `*.swp`, `.DS_Store`, `Thumbs.db`, `.trash/**`.

**Diagnostics**
- "View log" button — opens `sync.log` in a read-only modal.
- "Reset sync state" button — deletes `sync-state.json` with a confirmation dialog. Next sync will be a first-sync.
- "Enable verbose logging" toggle.

### 8.2 Status indicators

- **Ribbon icon** (sync icon, both desktop and mobile). Click = run sync. While syncing, icon spins.
- **Command palette entry:** "Sync with GitHub" (same action).
- **Concurrency guard:** ribbon clicks and command invocations are ignored while a sync is already in progress.
- **Status bar** (desktop only — mobile doesn't have a status bar): "Synced HH:MM" or "Never synced" or "Syncing…" or "Sync error (click for details)."

### 8.3 Conflict resolution modal

For ordinary syncs with conflicts.

Layout:
- Header: "Resolve N conflicts."
- For each conflict, a row with:
  - File path
  - Two-way diff view: local on the left, remote on the right (or stacked unified on mobile, where horizontal space is tight).
  - Two buttons: "Keep local" / "Keep remote."
- Footer:
  - "Apply selections and sync" (disabled until every conflict has a selection).
  - "Cancel sync" (always enabled).

Interaction:
- Clicking a side's button pre-selects it; user can change before applying.
- For binary files, the diff view shows "(binary file, N bytes locally, M bytes remotely)" instead of content — no diff rendering.

Diff rendering: use `diff` (the npm package) or hand-roll line-level Myers diff. The full `diff-match-patch` library is overkill for v1.

### 8.4 First-sync modal

Similar shape but with three sections:
- Summary: counts of local-only, remote-only, identical, conflicting.
- Conflicts list (same row UI as §8.3).
- A confirmation checkbox: "I understand this will pull <N> remote-only files into my vault and push <M> local-only files to GitHub."

### 8.5 Notices

- Sync started → no notice (ribbon icon spinner is enough).
- Sync succeeded → toast: "Synced <N> changes" or "Already up to date."
- Sync failed → toast: "Sync failed: <message>. See log for details."
- Files skipped (size limit) → toast lists the first 3 by name with "and N more" suffix.

---

## 9. Logging

All log writes go through a single Logger instance.

**File:** `.obsidian/plugins/<plugin-id>/sync.log`
**Format:** One JSON object per line (JSONL). Each entry has `{ts, level, event, ...fields}`.
**Rotation:** When the file exceeds 1 MB, rename to `sync.log.1` (overwriting any existing) and start fresh.
**Privacy:**
- Never log file contents.
- Never log the PAT. Even when logging request URLs, scrub the `Authorization` header.
- File paths are logged (they identify the user's note structure but are necessary for debugging).
- Commit SHAs and blob SHAs are logged.

**Levels:** `debug`, `info`, `warn`, `error`. `debug` only emitted when verbose logging is enabled in settings.

**Events to log:**
- `sync.start` — sync triggered.
- `sync.preflight.fail` — settings missing or test connection failed.
- `sync.fetch.head` — remote head fetched, includes commit SHA.
- `sync.scan.local` — local scan finished, file counts.
- `sync.scan.remote` — remote scan finished, file counts.
- `sync.conflicts` — conflict count and list of paths.
- `sync.pull.file` (debug only) — per-file pull.
- `sync.push.file` (debug only) — per-file push.
- `sync.commit` — new commit SHA.
- `sync.complete` — duration, change counts.
- `sync.error` — failure with structured error.
- `state.save` — state file written.
- `state.recover` — recovered from `.tmp` file on startup.
- `state.corrupt` — `sync-state.json` could not be parsed or failed schema validation; includes a `reason` field (`read-error`, `invalid-json`, `not-an-object`).
- `state.schema-mismatch` — state file has an unexpected `schemaVersion`; includes `expected` and `found` fields. Plugin treats the file as absent and triggers first-sync.
- `gh.ratelimit.warn` — rate-limit remaining dropped below 100; includes `remaining` and `resetAt` (Unix timestamp).

---

## 10. iOS-only mobile support

The user's hard requirement is iOS. Android is explicitly not supported in v1. Implementation:

- `manifest.json` sets `isDesktopOnly: false`, allowing install on any mobile.
- At plugin load, check `Platform.isAndroidApp`. If true, register a single command and a settings tab notice that says: "This plugin is not supported on Android. iOS and desktop only." Disable the sync ribbon icon.
- Do not crash, do not block load — Obsidian Sync may still want to replicate the plugin's data files between devices, and an unloaded plugin would interfere.
- README explicitly lists Android as unsupported.

If a user reports Android working fine: great, but it's not a release criterion and we don't fix Android-specific bugs in v1.

---

## 11. Testing strategy

### 11.1 Unit tests (desktop, Node)

- GitHub client: mocked HTTP, all error paths.
- Hash utilities: SHA-256 and git-blob-SHA-1 against known fixtures.
- State store: atomic writes, recovery from `.tmp`, schema migration scaffolding.
- Sync engine classifier: every cell of the §5.5 matrix as a separate test.
- Conflict resolution merging: every combination of resolutions.

### 11.2 Integration tests (desktop, real GitHub)

A test repo on a CI-owned GitHub account, with a fresh branch per test run.

- First-sync with empty repo, non-empty vault.
- First-sync with non-empty repo, empty vault.
- First-sync with both populated, including conflicts.
- Round-trip sync: change locally, sync, change remotely (via direct API), sync again.
- Concurrent-device race: two engine instances against the same repo, expect one to retry successfully.
- Tree truncation path: build a synthetic vault with >1k files (don't bother trying to hit the 100k limit).
- Per-file size-limit enforcement.

### 11.3 Manual mobile testing (iOS)

The single most important derisking step from the feasibility doc.

On an iPhone running Obsidian Mobile:
- Install via BRAT.
- First-sync against a real (small) test vault and test repo.
- Sync after editing on iOS only (push-only).
- Sync after editing remotely only (pull-only).
- Sync with a conflict; resolve via mobile UI.
- Force-quit Obsidian mid-sync; reopen; verify state recovers correctly (via the `.tmp` recovery path).
- 25 MB attachment; verify size-limit message.
- Toggle airplane mode mid-sync; verify failure mode.

### 11.4 Obsidian Sync coexistence test

Two devices both running Obsidian Sync and the GitHub sync plugin against the same vault.

- Edit on device A, sync to GitHub from A. Wait for Obsidian Sync to propagate to B. Sync from B — should be a no-op, not a conflict.
- Edit on device A, sync to GitHub from A. *Before* Obsidian Sync propagates, sync from B (B has stale `sync-state.json`). Verify B detects the staleness pattern (§4.4 case 3) and recovers.
- Edit on both devices, edit in agent on GitHub. Sync from one device. Verify the conflict UI shows the right conflicts and the resolution applies cleanly.

---

## 12. Open items deferred to v1.1+

Captured here so they're not lost.

- Branch switching as a setting (currently single configured branch).
- Multi-vault, multi-repo configs.
- Three-way diff in the conflict UI.
- Inline merge editing in the conflict UI.
- Optional desktop-side native git binary for users who want richer history (Option C from feasibility doc).
- GitHub commit signing (would require a server).
- Commit message templating.
- "Discard local changes" command.
- "Force overwrite remote" command (with significant guard rails).
- Submission to the official community plugin registry (see §14).

---

## 13. Licensing

**Decision: MIT License.**

Jackdaw is released under the MIT License. See `LICENSE` in the repository root.

Rationale: maximum permissiveness with zero friction for contributors. The Obsidian plugin ecosystem skews MIT, AGPL's network-use clause is largely theoretical for a client-side plugin, and Apache 2.0's patent grant adds little value given the plugin's implementation surface.

---

## 14. Distribution: BRAT-only beta

User has chosen BRAT-only distribution for the initial release. Tradeoffs:

**BRAT (Beta Reviewers Auto-update Tool)**
- *Pro:* Ship immediately. No registry review, no waiting weeks for the community-plugins PR to merge.
- *Pro:* Auto-updates work the same as registry plugins — users on BRAT get new releases automatically.
- *Pro:* Iterating freely: breaking changes, schema migrations, weird experiments, all fine. Audience is self-selected and tolerant.
- *Pro:* Can validate against the iOS / Obsidian Sync coexistence requirements with real users before stamping a 1.0.
- *Con:* Discoverability is near-zero. Users have to know about your plugin from a forum post, README link, or word of mouth.
- *Con:* Some users won't install from BRAT on principle (they consider it "unvetted"), even though the registry review is itself fairly light-touch.
- *Con:* Doesn't appear in Obsidian's in-app plugin browser, so iOS users in particular have a more involved install path (BRAT itself has to be installed via the registry first, then BRAT installs your plugin).

**Community plugin registry**
- *Pro:* Discoverability. Appears in the in-app browser and on `obsidian.md/plugins`. The dominant install path for non-power users.
- *Pro:* The review itself is a useful sanity check (catches manifest bugs, name collisions, policy violations).
- *Con:* Submission has constraints worth knowing now: ID and description can't include the word "obsidian," name must not collide with existing plugins, GitHub release tags must match `manifest.json` versions exactly (no `v` prefix), README must describe purpose and usage. Rejection requires a re-submission with a code change to retrigger checks.
- *Con:* Initial review can take weeks. Maintainer responsiveness is good but not instant.
- *Con:* Once submitted, users will report bugs faster than you can fix them. Better to do this *after* the BRAT phase has shaken out the obvious problems.

**Recommendation matches user's choice:** BRAT-only for the beta period. Plan to submit to the registry after:
1. Two consecutive weeks with no new bug reports of severity `high` or above.
2. iOS testing has covered all scenarios in §11.3.
3. The Obsidian Sync coexistence tests (§11.4) all pass.
4. README and screenshots are polished enough to survive registry review on the first or second submission.

The registry submission becomes a v1.1 milestone, not a v1 blocker.

---

## 15. Acceptance criteria for v1.0 (BRAT release)

- All scenarios in §11.3 (manual iOS testing) pass.
- All scenarios in §11.4 (Obsidian Sync coexistence) pass.
- Sync of a 1,000-file text vault completes in under 30 seconds when there are no changes (no-op sync should be cheap).
- Sync of the same vault with 10 changed files completes in under 60 seconds.
- Conflict UI is usable on a phone screen (informal test: can resolve 5 conflicts without scrolling rage).
- PAT never appears in the log file under any code path.
- Force-quit during any phase of sync leaves the vault in a recoverable state.
- README clearly states: iOS-only mobile support, BRAT installation steps, the PAT-on-every-device implication of using Obsidian Sync, the manual-only sync model, and the lack of branching/merging.
