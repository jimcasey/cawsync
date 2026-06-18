# Manual Testing

Steps to configure and manually test the plugin across platforms and phases.

---

## GitHub personal access token setup

Jackdaw authenticates with GitHub using a personal access token (PAT). Create one before configuring the plugin.

**Prerequisites:** create a small dedicated GitHub repository to use as your sync target (e.g. `yourname/obsidian-test`). Avoid using a production repo until you are confident in the plugin's behavior.

> **Important:** the repository must already have at least one commit on the target branch (e.g. `main`). A brand-new empty repo will fail to sync because the branch ref does not exist yet. The simplest fix is to check **Add a README file** when creating the repo on GitHub, or push an empty commit:
> ```sh
> git clone https://github.com/<owner>/<repo>.git
> cd <repo>
> git commit --allow-empty -m "init"
> git push -u origin main
> ```

1. In GitHub, go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Click **Generate new token**.
3. Set an **Expiration** (90 days is a reasonable default; you will need to regenerate and re-enter it when it expires).
4. Under **Repository access**, select **Only select repositories** and choose your sync repo.
5. Under **Permissions → Repository permissions**, set **Contents** to **Read and write**. No other permissions are needed.
6. Click **Generate token** and copy the value immediately — GitHub shows it only once.
7. Paste the token into Obsidian → Settings → Jackdaw → **Personal access token**.

> **Security note:** store the PAT only in the Jackdaw settings field. Do not commit it to any file. The plugin never logs it — PAT values are scrubbed from `sync.log` automatically.

---

## Desktop setup (Phase 3+ gate)

Before signing off on any phase from Phase 3 onward, smoke-test the plugin in Obsidian desktop:

1. Symlink the repo into your vault's plugins folder:
   ```sh
   ln -s /path/to/jackdaw <your-vault>/.obsidian/plugins/jackdaw
   ```
2. Run `npm install && npm run build` from the repo directory.
3. In Obsidian → Settings → Community plugins, disable Safe mode and enable **Jackdaw**.
4. Open Settings → Jackdaw and enter:
   - **PAT** — a GitHub personal access token with `repo` scope (see [GitHub personal access token setup](#github-personal-access-token-setup) above).
   - **Repository** — `owner/repo` of a small test repo you control.
   - **Branch** — the branch to sync against (e.g. `main`).
5. Click the sync ribbon icon. Verify the status bar shows "Syncing…" and then a success message.
6. Make a local edit, sync again, and confirm the change appears in the GitHub repo.
7. Make a remote edit via the GitHub web UI, sync, and confirm the vault file is updated.

---

## Integration tests (§11.2)

Automated end-to-end tests that exercise the sync engine against a real GitHub repository. Live in `tests/integration/` and run under a separate vitest config so they never trip during `npm test`.

### Sandbox repo

Tests run against a dedicated sandbox repository identified by the `JACKDAW_TEST_REPO` env var. The conventional value (used by CI) is `jimcasey/jackdaw-ci-sandbox`. The repo has a long-lived `main` seed branch with a small fixture commit; each test creates a fresh per-run branch off `main` and deletes it on teardown. Nothing in the harness touches `main` directly.

If the sandbox repo doesn't exist yet, create it as an empty repo with a single commit on `main` (e.g. add a README on creation) before running the suite.

### Running locally

1. Create a fine-grained personal access token scoped to **only the sandbox repo**, with **Contents: read & write**, expiring in 90 days. (Same shape as the [GitHub personal access token setup](#github-personal-access-token-setup) above, but pointed at the sandbox.)
2. Export the env vars and run:
   ```sh
   export JACKDAW_GH_TOKEN=<your-pat>
   export JACKDAW_TEST_REPO=jimcasey/jackdaw-ci-sandbox
   npm run test:integration
   ```
3. The suite creates and deletes its own branches. If a run is killed mid-test, orphaned `ci/...` branches may remain on the sandbox — they are safe to delete by hand from the GitHub UI.

### Running in CI

The workflow is `.github/workflows/integration.yml`. It triggers on push to `main` and on manual `workflow_dispatch` from the Actions tab. It does **not** run on pull requests (PRs from forks cannot read the secret, and PR runs against the sandbox would race with each other).

The PAT is stored as the repository secret `INTEGRATION_TEST_GH_TOKEN`.

### Rotating the integration PAT

Fine-grained tokens expire (default 90 days). To rotate:

1. In GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**, generate a replacement scoped to `jimcasey/jackdaw-ci-sandbox` with **Contents: read & write** and a new 90-day expiry.
2. In the `jackdaw` repo → **Settings → Secrets and variables → Actions**, update `INTEGRATION_TEST_GH_TOKEN` with the new value.
3. Trigger the **Integration** workflow via `workflow_dispatch` to confirm the new token works.
4. Revoke the old token from the fine-grained tokens page.

Set a calendar reminder for a few days before expiry — the workflow will start failing once the old token expires.

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
