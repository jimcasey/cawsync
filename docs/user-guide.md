# Jackdaw user guide

A long-form walkthrough for configuring, running, and troubleshooting Jackdaw. Start with the [README](../README.md) for a quick install via BRAT; come back here when you need details on a specific setting, want to understand what the first-sync modal is showing you, or hit an error you don't recognize.

- [Generating a GitHub personal access token](#generating-a-github-personal-access-token)
- [Initial configuration](#initial-configuration)
- [First sync walkthrough](#first-sync-walkthrough)
- [Day-to-day usage](#day-to-day-usage)
- [Troubleshooting](#troubleshooting)
- [Reset sync state](#reset-sync-state)

---

## Generating a GitHub personal access token

Jackdaw authenticates to GitHub with a **fine-grained personal access token (PAT)** scoped to a single repository. There is no OAuth flow — you create the token in GitHub once, paste it into Obsidian, and rotate it when it expires.

**Prerequisites.** Create a small dedicated repository to use as your sync target (e.g. `yourname/obsidian-vault`). The repository must already have at least one commit on the target branch — a brand-new empty repo will fail with `GHEmptyRepoError` because the branch ref does not exist yet. The simplest fix is to check **Add a README file** when creating the repo on GitHub. (See [Empty repository](#empty-repository) below if you hit this.)

### Steps

1. In GitHub, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Click **Generate new token**.
3. Give it a recognizable name (e.g. `obsidian-jackdaw`).
4. Set an **Expiration**. **90 days** is a reasonable default — long enough not to be annoying, short enough that a leaked token has a fixed blast radius. Add a calendar reminder for the rotation date.
5. Under **Repository access**, choose **Only select repositories** and select your sync repo. Do not grant access to all repositories.
6. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**. No other permissions are needed. Jackdaw never touches issues, pull requests, actions, or settings.
7. Click **Generate token** and copy the value immediately — GitHub displays the token exactly once.
8. In Obsidian, open **Settings → Jackdaw → Connection → Personal access token** and paste the token.

### Rotation cadence

When the token expires, syncs will start failing with `GHAuthError`. Generate a new token following the same steps and paste it into the same field. If you set a 90-day expiry, expect to do this four times a year per device.

### Security notes

- Store the PAT only in the Jackdaw settings field. Never commit it anywhere.
- Jackdaw never logs the PAT. The logger scrubs the token from log lines via string replacement and a header regex; this is enforced regardless of log level. If you find a PAT in your `sync.log`, that is a bug worth reporting.
- The PAT is stored inside `data.json`, which lives at `.obsidian/plugins/jackdaw/data.json`. If you use Obsidian Sync, this file (and therefore the PAT) is replicated end-to-end-encrypted to your other devices. That is usually what you want for personal use; if it isn't, set a unique PAT per device — see the [README caveats](../README.md#caveats).

---

## Initial configuration

Open **Settings → Jackdaw**. The settings tab is divided into four sections.

### Connection

| Setting | What it does | Safe default |
|---|---|---|
| **Repository owner** | The GitHub username or organization that owns the sync repo. The bit before the slash in `owner/repo`. | (none — you must set this) |
| **Repository name** | The repo name. The bit after the slash. | (none — you must set this) |
| **Branch** | The single branch Jackdaw syncs against. Jackdaw never switches branches and never creates new ones. | `main` |
| **Personal access token** | The fine-grained PAT from the section above. Stored as a password field; never displayed in logs. | (none — you must set this) |

The **Test connection** button (under Diagnostics) calls `getBranch` against your settings and surfaces the typed error class if anything is wrong. Run it after first configuration; if it succeeds, you are ready to sync.

### Sync behavior

| Setting | What it does | Safe default |
|---|---|---|
| **Conflict policy** | How to handle files modified both locally and remotely since the last sync. `Always ask` opens the [conflict resolution modal](#conflict-resolution-modal) per sync; `Always prefer local` and `Always prefer remote` skip the UI entirely and apply the chosen side without prompting. The non-interactive policies are intended for headless or scripted use; most users should leave this on `Always ask`. | `Always ask` |
| **Per-file size limit (MB)** | Files larger than this limit are skipped on both pull and push. The skip is reported in the post-sync notice. Whole number, 0–100. The hard ceiling is GitHub's 100 MB blob cap, but you almost never want to sync files that large through this plugin. | `25` |
| **Device name** | Appears in commit messages (e.g. `Sync from iPhone`). Leave blank to use `Obsidian` as the default. | `` (uses `Obsidian`) |

### Inclusion

| Setting | What it does | Safe default |
|---|---|---|
| **Include `.obsidian` configs** | When on, Jackdaw syncs your Obsidian configuration (themes, plugin settings, hotkeys) under `.obsidian/`. Most users do **not** need this — Obsidian Sync already replicates `.obsidian/` between devices. Enabling this pushes potentially sensitive plugin configs to GitHub. Jackdaw's own data and state files (`data.json`, `sync-state.json`, `sync.log`) are always excluded regardless. | off |
| **Exclude patterns** | One glob per line. Files matching any pattern are excluded from sync in both directions. Patterns starting with `#` are treated as comments. | `*.tmp`, `*.swp`, `.DS_Store`, `Thumbs.db`, `.trash/**` |

### Diagnostics

| Setting | What it does |
|---|---|
| **Test connection** | Calls `getBranch` and reports the head commit SHA on success or a typed error on failure. Use this after entering or rotating the PAT. |
| **View log** | Opens `sync.log` in a read-only modal with a Copy button. The log path is shown beneath the contents in case you need to grep or share it. |
| **Reset sync state** | Deletes `sync-state.json`. The next sync becomes a [first-sync](#first-sync-walkthrough). See [Reset sync state](#reset-sync-state) below for when to use it. |
| **Verbose logging** | Logs per-file pull and push events to `sync.log`. Use only when debugging — turning it on for steady-state use bloats the log without telling you anything new. |

---

## First sync walkthrough

The **first sync** is the one Jackdaw runs when no `sync-state.json` exists yet — typically the first time you click the ribbon icon, or any time you reset state. Instead of comparing local and remote against a known baseline (the steady-state sync algorithm), it compares them directly against each other and asks you to confirm.

### What you'll see

When the first-sync modal opens, you get three things:

1. **Summary block.** Counts of:
   - **Local-only** files — present in your vault, not in the repo. These will be **pushed** if you proceed.
   - **Remote-only** files — present in the repo, not in your vault. These will be **pulled** if you proceed.
   - **Identical** files — present on both sides with matching content. Jackdaw computes the git blob SHA-1 locally and compares it to the SHA the repo already published, so identical files are detected without downloading them. They are recorded in state and otherwise skipped.
   - **Conflicting** files — present on both sides with differing content. These need a per-file decision.

2. **Conflicts list.** One row per conflicting file. Rows are collapsed by default; expanding a row triggers a lazy fetch of the remote bytes plus a diff against your local copy. For text files you get a line-level diff (local on the left, remote on the right; stacked unified on mobile). For binary files you get `(binary file, N bytes locally, M bytes remotely)` — no diff is rendered. Choose **Keep local** or **Keep remote** per row; you can change your mind before applying.

3. **Confirmation checkbox.** `I understand this will pull <N> remote-only files into my vault and push <M> local-only files to GitHub.` The **Apply** button stays disabled until the checkbox is checked **and** every conflict has a resolution.

### Why this exists

A first sync against a populated vault and a populated repo can mean hundreds of files moving in both directions. The summary block + checkbox is intentional friction — once you click Apply, the plugin pulls remote-only files into your vault and creates a commit for the local-only ones, and that's harder to undo than to confirm.

### Cancelling

Clicking **Cancel sync** (or closing the modal) aborts the sync without writing anything to your vault, the repo, or `sync-state.json`. The next sync will see the same first-sync state and prompt again. Cancelling is always safe.

---

## Day-to-day usage

### The sync ribbon

The sync icon in Obsidian's left ribbon is the only way to start a sync from the UI. Click = run sync. While syncing, the icon spins. There is no autosync, no interval sync, and no event-driven sync — every sync is initiated by you.

The same action is bound to the command **Sync with GitHub** in the command palette (Ctrl/Cmd+P). If a sync is already in progress, additional ribbon clicks and command invocations are ignored.

### The status bar (desktop only)

On desktop, Obsidian displays a status bar at the bottom of the window. Jackdaw reports its state there:

| State | Display |
|---|---|
| Idle, never synced | `Jackdaw: Never synced` |
| Idle, synced before | `Jackdaw: Synced HH:MM` |
| Currently syncing | `Jackdaw: Syncing…` |
| Last sync errored | `Jackdaw: Sync error` (the full error message is exposed on hover via `aria-label`) |

Mobile Obsidian has no status bar; on iOS the ribbon icon is your only at-a-glance indicator.

### Sync notices

When a sync finishes, Jackdaw shows a toast notice. The text varies with the outcome:

| Notice | What it means |
|---|---|
| `Already up to date.` | Nothing changed locally or remotely since the last sync. |
| `Synced N changes.` | N files were added, modified, or deleted across both sides. |
| `Skipped: file1, file2, file3 and N more` | Files larger than the per-file size limit. Increase the limit or move them out of the vault if you need them synced. |
| `Sync failed: <message>. See log for details.` | A typed error stopped the sync. See [Troubleshooting](#troubleshooting) for the specific error. |
| (toast: `The repository exists but has no commits yet…`; status bar: `Jackdaw: Sync error`) | `GHEmptyRepoError`. See [Empty repository](#empty-repository). |

The status bar mirrors the same outcome — `Synced HH:MM` on success, an error message on failure.

### Conflict resolution modal

When a non-first-sync detects files modified on both sides since the last sync, Jackdaw opens the conflict resolution modal (unless you have set `conflictPolicy` to `Always prefer local` or `Always prefer remote`, in which case the chosen side wins silently).

Layout:

- Header: `Resolve N conflicts.`
- One row per conflict, collapsed by default, with **Keep local** / **Keep remote** buttons.
- Expanding a row triggers a lazy fetch of the remote bytes plus a diff against your local copy. The same row component is used as in the first-sync modal.
- Footer: **Apply selections and sync** (disabled until every conflict has a selection) and **Cancel sync** (always enabled).

Apply your selections to continue the sync. Cancelling aborts without writing anything.

---

## Troubleshooting

Every Jackdaw error is one of seven typed classes from `src/github-client.ts`. The `View log` button in Diagnostics shows the structured log entry for any failure; each entry has a `name` field matching the class name below.

### `GHAuthError` — authentication failed

**Symptom.** `Sync failed: Authentication failed. Check your token.`

**Causes.**
- The PAT has expired (most common — check the expiration date in GitHub).
- The PAT was revoked or regenerated elsewhere.
- The PAT was pasted incorrectly (extra whitespace, truncated copy).
- The PAT lacks **Contents: Read and write** permission for the repo.

**Fix.** Generate a new PAT following [the steps above](#generating-a-github-personal-access-token), paste it into Settings → Connection → Personal access token, and click **Test connection**.

### `GHNotFoundError` — repo or branch not found

**Symptom.** `Sync failed: Not found: /repos/<owner>/<repo>/branches/<branch>. The resource may not exist or your token may lack permissions.`

**Causes.**
- A typo in `owner`, `repo`, or `branch`.
- The PAT is scoped to a different repository.
- The repo was renamed, transferred, or deleted.
- The branch you configured does not exist on the repo.

**Fix.** Double-check the three Connection fields against the repo URL on GitHub. If the values are right, regenerate the PAT and confirm it grants access to that exact repo.

<a id="empty-repository"></a>
### `GHEmptyRepoError` — empty repository

**Symptom.** `Sync failed: The repository exists but has no commits yet. Push an initial commit (e.g. a README) and try again.`

**Causes.** The repo was created without an initial commit, so the branch ref does not exist.

**Fix.** On GitHub, add a README via the web UI and commit it (this creates the branch ref). Or from a clone:

```sh
git clone https://github.com/<owner>/<repo>.git
cd <repo>
git commit --allow-empty -m "init"
git push -u origin main
```

### `GHRateLimitError` — rate limit exhausted

**Symptom.** `Sync failed: GitHub rate limit exhausted. Resets at <ISO timestamp>.` or `Rate limit exceeded after 3 retries. Retry after <ms>ms.`

**Causes.**
- Authenticated GitHub API requests are capped at 5,000/hour. A first-sync of a large vault can approach this if combined with other tools using the same token.
- Secondary rate limits trigger on rapid creation of blobs/commits.

**Fix.** Wait until the reset time shown in the message, then sync again. Jackdaw retries with exponential backoff up to three times before surfacing this; if you hit it repeatedly, check whether another tool (CI, another plugin) is consuming the same PAT's quota.

### `GHFastForwardError` — ref update rejected

**Symptom.** `Sync failed: Ref update rejected (fast-forward required). Another client may have pushed to the branch.`

**Causes.** Between the time Jackdaw fetched the branch head and the time it tried to update it, another client (you on a different device, an agent, GitHub Actions, anyone) pushed a new commit. The new commit isn't a parent of Jackdaw's, so the update would not be a fast-forward.

**Fix.** Jackdaw retries this race up to twice automatically. If you see the user-facing error, retries are exhausted. Click **Sync** again — the second attempt re-fetches the branch and incorporates the other client's commit. If you keep seeing it, you have a runaway loop somewhere; pause the other client.

### `GHNetworkError` — network failure

**Symptom.** `Sync failed: Network error: <details>.`

**Causes.** The HTTPS request failed before getting a response. Common on mobile when toggling airplane mode mid-sync, on flaky Wi-Fi, or behind captive portals.

**Fix.** Jackdaw retries network failures once before surfacing this. Confirm you have connectivity and try again. Nothing has been written to your vault, the repo, or `sync-state.json` if the failure happened pre-flight.

### `GHServerError` — GitHub returned 5xx

**Symptom.** `Sync failed: Server error <status>: <body>.`

**Causes.** GitHub's API is having a bad time. Check [GitHub's status page](https://www.githubstatus.com/).

**Fix.** Jackdaw retries 5xx responses up to three times with exponential backoff before surfacing this. If retries are exhausted, wait and try again.

### Reading `sync.log`

The log is a JSONL file at `.obsidian/plugins/jackdaw/sync.log`. One JSON object per line, each with at minimum `{ts, level, event, ...fields}`. When the file exceeds 1 MB it is rotated to `sync.log.1` (overwriting any existing rotated copy) and a fresh `sync.log` is started.

Useful events to grep for:

| Event | Meaning |
|---|---|
| `sync.start` | A sync was triggered. |
| `sync.preflight.fail` | Settings were missing or the test connection failed. |
| `sync.fetch.head` | The remote branch head was fetched; includes the commit SHA. |
| `sync.scan.local` / `sync.scan.remote` | Local or remote change set was built; includes file counts. |
| `sync.conflicts` | Conflicts were detected; includes the count and list of paths. |
| `sync.commit` | A new commit was created; includes the new commit SHA. |
| `sync.complete` | Sync succeeded; includes duration and change counts. |
| `sync.error` | Sync failed; includes the error class name and message. |
| `state.recover` | Recovered from `.tmp` after a crashed write. |
| `state.corrupt` / `state.schema-mismatch` | `sync-state.json` was unparseable or had the wrong schema; Jackdaw treats it as absent and triggers a first-sync. |
| `gh.ratelimit.warn` | API quota dropped below 100 remaining; not an error, just a heads-up. |

The log never contains file contents and never contains the PAT. File paths are logged because they're necessary for debugging.

---

## Reset sync state

**Settings → Diagnostics → Reset sync state** deletes `.obsidian/plugins/jackdaw/sync-state.json`. The confirmation dialog spells out exactly what happens:

> This deletes `.obsidian/plugins/jackdaw/sync-state.json`. The next sync will scan the entire vault and the entire repository, and may prompt you to resolve conflicts. **This does not delete any notes or any commits on GitHub.**

### When to use it

- The sync state file got corrupted or schema-mismatched. (Jackdaw also auto-recovers from this — corruption triggers a first-sync on its own — but the manual reset is faster if you already know that's what happened.)
- You changed the configured branch and want a clean first-sync against the new branch instead of carrying state from the old one.
- You're testing the first-sync flow and want to retrigger it.

### When *not* to use it

- You want to undo a sync. Reset state cannot do this. Reset state forgets that a sync happened; it does not roll back the changes that sync made to your vault or to the repo.
- You're trying to resolve a conflict by "starting fresh." Reset state will just re-prompt with the same conflict via the first-sync modal.
- A sync errored. Reset state does not help with errors — fix the underlying cause from [Troubleshooting](#troubleshooting) instead.

### What it doesn't do

- It does **not** delete any files from your vault.
- It does **not** delete any commits or branches from GitHub.
- It does **not** revoke or rotate your PAT.
- It does **not** change any of your other settings.

The next sync after a reset is a full first-sync, with the summary block and confirmation checkbox described above. Identical files (detected via blob SHA-1) are recorded in the new state without re-downloading them, so the reset is cheap when local and remote are already in agreement.

---

## See also

- [Design specification](design-specification.md) — authoritative reference for the sync algorithm, state model, and constraints.
- [Architecture decision records](adr/) — design decisions with rationale.
- [Manual testing guide](testing.md) — used by maintainers to validate releases.
- [Contributing](../CONTRIBUTING.md) — building, testing, and developing the plugin.
