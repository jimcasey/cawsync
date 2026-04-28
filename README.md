# Jackdaw

A manual, bidirectional, one-button synchronizer between an Obsidian vault and a single branch of a single GitHub repository.

## Getting started

**Prerequisites:** Node.js 20+, npm

```sh
git clone https://github.com/jimcasey/jackdaw.git
cd jackdaw
npm install
npm run build     # produces main.js
```

**Load in Obsidian:**

1. Copy (or symlink) this directory into `<your-vault>/.obsidian/plugins/jackdaw/`.
2. In Obsidian → Settings → Community plugins, disable Safe mode and enable **Jackdaw**.
3. For development, run `npm run dev` for watch mode and use **Reload app without saving** (Ctrl/Cmd+P) after each rebuild.

## Architecture

Six modules make up the plugin:

- **`src/main.ts`** — Plugin entry point; registers the ribbon icon and sync command.
- **`src/github-client.ts`** — GitHub REST API wrapper using Obsidian's `requestUrl`; handles auth, rate limits, and base64 encoding.
- **`src/sync-engine.ts`** — Core sync state machine: pre-flight → scan → classify → pull → push → save state.
- **`src/state-store.ts`** — Owns `sync-state.json` (file hashes and blob SHAs). Atomic writes via temp-file rename.
- **`src/logger.ts`** — JSONL log with automatic 1 MB rotation. Never logs secrets or file contents.
- **`src/ui/`** — Settings tab, ribbon icon, status bar, and conflict-resolution modals.

## Docs

- [Design Specification](docs/design-specification.md)
- [Workflow](docs/workflow.md)
- [Human Interaction Gates](docs/human-interactions.md)
- [ADR: MIT License](docs/adr/001-mit-license.md)
