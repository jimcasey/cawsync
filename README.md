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

## Docs

- [Design Specification](docs/design-specification.md)
- [Workflow](docs/workflow.md)
- [ADRs](docs/adr/)
