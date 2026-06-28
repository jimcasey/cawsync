# ADR 002 — .git/ hard-exclusion and vault-root .gitignore respecting

**Status:** Accepted
**Date:** 2026-04-29
**Decider:** Jim Casey
**Relates to:** Issue #25

## Decision

1. `.git/` is hard-excluded from sync, always and at the directory level. No user opt-out.
2. If a `.gitignore` file exists at the vault root, Cawsync reads it and applies its positive patterns as additional exclusions during the local file scan. Only the vault-root `.gitignore` is read; subdirectory `.gitignore` files, `.git/info/exclude`, and the user's global gitignore are ignored.
3. `.gitignore` and `.gitattributes` are **not** hard-excluded. They are legitimate vault content that the user may want to sync.
4. Pattern negation lines in `.gitignore` (lines beginning with `!`) are silently skipped for v1. The user can override exclusions via the exclude-pattern settings field if needed.

## Context

An Obsidian vault may sit inside a `git` working tree — either deliberately (the user manages the vault as a git repo) or accidentally (Obsidian Sync copied the vault folder onto a machine that lives inside a checked-out repo). Without intervention, the file scanner would walk into `.git/`, which can contain hundreds of thousands of objects in an active repository. More critically, the resulting sync state and commit would be nonsensical: pack files, ORIG_HEAD, reflogs, etc., pushed to an unrelated GitHub repo.

The comment on issue #25 raised the complementary question: if a `.gitignore` already expresses what the user wants excluded from version control, Cawsync should respect that intent rather than requiring the user to duplicate the patterns in its settings.

## Rationale

**Hard-exclude `.git/` at the directory level (not file level).** Walking the directory only to skip every file wastes I/O on large repos. The scanner should never descend into `.git/`. This is not a user-configurable behaviour: there is no meaningful use case for pushing git internals to a GitHub repo via Cawsync.

**Read vault-root `.gitignore` only.** Subdirectory `.gitignore` files require recursive accumulation during the tree walk (each directory's patterns apply to its subtree only). That logic significantly complicates the scanner for v1. The vault-root file covers the most common cases: language build artifacts, OS noise files, IDE directories. Subdirectory `.gitignore` support is deferred to a later issue.

**Skip negation patterns rather than failing.** Gitignore negation (`!pattern`) reverses a prior exclusion. Implementing it correctly requires ordered pattern evaluation. For v1, negation lines are ignored. This is safe: unrecognised lines are skipped, so the worst outcome is that a file the user expected to be un-excluded remains excluded. The settings tab's exclude-patterns field provides a manual escape hatch.

**Do not hard-exclude `.gitignore` itself.** The file is text, is potentially useful in the vault (documents what's excluded), and users may legitimately want it in GitHub. The same logic applies to `.gitattributes`.

**No UX warning for `.git/` detection.** A status-bar or modal notice adds noise for users who chose to live inside a working tree deliberately. Silent skip is consistent with how the self-exclusion of plugin data files already works.

## Consequences

- The file scanner must check, before descending into any directory, whether the directory name is `.git`. This check belongs in the adapter walk, not in the per-file exclusion filter.
- The file scanner must read `.gitignore` at the start of the local-scan phase, parse it into a pattern list, and include those patterns in the same glob-match filter used for user-configured exclude patterns.
- Design spec §5.3 must be updated to document both the `.git/` hard-exclusion and the `.gitignore` integration.
- Subdirectory `.gitignore` support is explicitly out of scope for v1 and may be filed as a separate issue.
