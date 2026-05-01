# Jackdaw

Manual, bidirectional, one-button sync between an Obsidian vault and a single branch of a single GitHub repository. Designed to enable agentic AI tools (like Claude Code) to edit your vault by using GitHub as the transport: click sync, let an agent edit the repo, click sync again to pull the agent's changes back into Obsidian. Runs on Obsidian desktop and iOS.

## Screenshots

| Settings | Mid-sync |
|---|---|
| ![Settings tab showing Connection, Sync behavior, Inclusion, and Diagnostics sections.](docs/screenshots/settings-tab.png) | ![Sync ribbon and status bar mid-sync.](docs/screenshots/sync-in-progress.png) |

| Conflict resolution | First sync |
|---|---|
| ![Conflict resolution modal with one row expanded showing a line-level diff.](docs/screenshots/conflict-modal.png) | ![First-sync modal with summary block, conflicts list, and confirmation checkbox.](docs/screenshots/first-sync-modal.png) |

## Install via BRAT

Jackdaw is distributed as a beta plugin via [BRAT](https://github.com/TfTHacker/obsidian42-brat) (Beta Reviewers Auto-update Tool). It is not yet in Obsidian's community plugin registry.

1. In Obsidian → **Settings → Community plugins**, disable Safe mode if it's on.
2. Browse community plugins, install **Obsidian42 - BRAT**, and enable it.
3. Open **Settings → BRAT → Beta Plugin List → Add Beta plugin**.
4. Paste the repository path: `jimcasey/jackdaw`.
5. Click **Add Plugin**. BRAT will fetch the latest release.
6. Back in **Settings → Community plugins**, enable **Jackdaw**.

BRAT auto-updates Jackdaw the same way the registry would, so you get new releases without manual intervention.

## Quick configuration

Open **Settings → Jackdaw**. The minimum to get going:

1. **Personal access token.** A fine-grained GitHub PAT scoped to the sync repo with **Contents: Read and write**. Step-by-step in the [user guide](docs/user-guide.md#generating-a-github-personal-access-token).
2. **Repository owner** and **Repository name.** The two halves of `owner/repo` from the GitHub URL.
3. **Branch.** The single branch to sync against. Default `main`.
4. Click **Test connection** under Diagnostics to confirm everything is wired up.
5. Click the sync ribbon icon. The first sync opens a modal that summarizes what will be pulled and pushed and asks for confirmation — see the [first-sync walkthrough](docs/user-guide.md#first-sync-walkthrough).

The repo must already have at least one commit on the configured branch, otherwise sync will fail with `GHEmptyRepoError`. The simplest fix is to check **Add a README file** when creating the repo on GitHub.

For everything else — every settings field explained, the conflict modal walkthrough, troubleshooting per error class — see the [user guide](docs/user-guide.md).

## Caveats

A handful of things to know before you commit (sorry) to using Jackdaw:

- **iOS-only mobile support.** Jackdaw runs on Obsidian desktop and Obsidian iOS. **Android is explicitly not supported in v1.** The plugin will not crash on Android, but it short-circuits at load time: the sync ribbon is not registered and the settings tab shows an unsupported notice. There is no plan to add Android support during the BRAT beta.
- **PAT must be configured per device.** Obsidian Sync replicates `data.json` (which stores the PAT) end-to-end-encrypted between devices, so the PAT *will* propagate by default. That is usually convenient for personal use, but if you'd rather scope tokens per device — for example, to limit blast radius on a lost phone — set a unique fine-grained PAT on each device after enabling the plugin.
- **Manual sync only.** No autosync, no interval sync, no event-driven sync, no background sync. Every sync is initiated by you clicking the ribbon icon (or running the **Sync with GitHub** command). This is by design; the primary use case is "click sync → agent edits repo → click sync again."
- **One configured branch, no branching or merging.** Jackdaw operates against a single branch. There is no branch switching, no merging, no rebasing, no cherry-picking, no tag management, no history browsing. If you need to move work between branches, do it on GitHub and re-point Jackdaw.
- **Beta-quality software.** Jackdaw is in BRAT beta. Test against a throwaway vault and a dedicated test repo before pointing it at notes you care about. Reset sync state from the diagnostics panel if you get into a weird state.

## Links

- [User guide](docs/user-guide.md) — PAT setup walkthrough, every settings field, day-to-day usage, and troubleshooting per error class.
- [Design specification](docs/design-specification.md) — authoritative reference for the sync algorithm, state model, and constraints.
- [Architecture decision records](docs/adr/) — design decisions with rationale.
- [Contributing](CONTRIBUTING.md) — building from source, testing, and the development workflow.
- [License](LICENSE) — MIT.
