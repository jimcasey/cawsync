# Phase 1 Retrospective

**Date:** 2026-04-29
**Issues closed:** #28, #29, #31, #32, #33, #34, #35, #37
**Retrospective issue:** #26

---

## What was built

Phase 1 delivered the six foundation modules:

| File | Highlights |
|---|---|
| `src/hash.ts` | `sha256` and `gitBlobSha1` via `crypto.subtle.digest`. Exact match to §7 spec utility. |
| `src/constants.ts` | `PLUGIN_ID`, `SELF_EXCLUDED_PATHS`, `BINARY_EXTENSIONS`. |
| `src/settings.ts` | `Settings` interface and `DEFAULT_SETTINGS`. |
| `src/logger.ts` | JSONL, 1 MB rotation, PAT scrubbing via string replace + Authorization header regex. |
| `src/state-store.ts` | Atomic writes, `.tmp` recovery, schema validation on load. `StateAdapter` interface for testability. |
| `src/github-client.ts` | Full REST surface, six typed error classes, 5xx retry, chunked base64 encoder. |

Phase 1 also closed ADR 002 (`.git/` hard-exclusion and vault-root `.gitignore` respecting, issue #37).

---

## Divergences from the design spec (all resolved — spec updated)

### §6 GitHub client

**Error taxonomy (spec was under-specified):**
The spec named only `GHFastForwardError`. Implementation defines six typed error classes:
- `GHAuthError` — 401
- `GHNotFoundError` — 404
- `GHRateLimitError` — rate limit exhausted or secondary-limit retries exceeded; carries `retryAfterMs`
- `GHFastForwardError` — 422
- `GHNetworkError` — transport-level failure after one retry
- `GHServerError` — 5xx or unexpected status; carries `status`

Decision: update spec to document the full taxonomy. The richer types improve the sync engine's ability to handle errors precisely.

**5xx retry (spec omitted):**
The spec described secondary rate-limit retries and a single network retry but said nothing about 5xx server errors. Implementation retries 5xx up to 3 times with exponential backoff. Decision: update spec §6.4 to document this.

**422 scope (spec said "on ref update" only):**
Code throws `GHFastForwardError` for any 422, not just from `updateRef`. In practice GitHub only sends 422 on ref updates, but the code doesn't scope the check to one method. Decision: document the actual behavior ("in practice: updateRef only") in spec §6.1, no code change needed.

**Constructor shape (spec omitted):**
Spec showed only the method surface. Implementation uses getter functions for PAT/owner/repo (so settings changes are picked up on the next call without recreating the client) plus an injectable sleep function for tests. Decision: document constructor in spec §6.1.

**`GHLogger` interface (spec omitted):**
Client takes a minimal `GHLogger` (only `warn`) rather than the full `Logger`. Keeps the client decoupled from the logger's full interface. Decision: document in spec §6.1.

**`encodeBase64Chunked` public export (spec mentioned need, not API):**
Spec §6.5 noted the need for chunked encoding. Implementation exports `encodeBase64Chunked` as a named function so tests can cover it directly. Decision: document in spec §6.1.

### §9 Logging

**Three events missing from the spec's list:**
- `state.corrupt` — emitted by `StateStore.load()` on read errors, invalid JSON, or non-object content.
- `state.schema-mismatch` — emitted when `schemaVersion` doesn't match; plugin treats state as absent and triggers first-sync.
- `gh.ratelimit.warn` — emitted by `GitHubClient` when `X-RateLimit-Remaining` drops below 100.

Decision: add all three to spec §9 events list.

### §4 State model

**`StateAdapter` interface (spec assumed `DataAdapter` directly):**
`StateStore` takes a `StateAdapter` abstraction (`exists`, `read`, `write`, `rename`) rather than Obsidian's `DataAdapter`. This allows the unit tests to pass a plain in-memory adapter without an Obsidian environment. Decision: document in spec §4.2, no design concern.

**`SELF_EXCLUDED_PATHS` is broader than spec §4.4 item 5:**
Spec listed `data.json`, `sync-state.json`, and `sync.log` as hard-excluded. Constants also exclude `sync-state.json.tmp` and `sync.log.1` (the rotation backup). Decision: update CLAUDE.md constraint note; spec §4.4 item 5 is implicitly covered (the `.tmp` and `.1` files are implementation details of those exclusions).

### CLAUDE.md / workflow.md

Phase 1 delivered three modules (`hash.ts`, `settings.ts`, `constants.ts`) not listed in the Phase 1 milestone description in `workflow.md` or the architecture section in `CLAUDE.md`. Both updated.

---

## What surprised us

- The chunked base64 encoder was needed immediately (during Phase 1 itself, not deferred to the sync engine) because `encodeBase64Chunked` is referenced by `createBlob`. The spec mentioned it as an implementation note; it was promoted to a proper tested export.
- The `StateAdapter` interface emerged naturally from wanting a unit test that doesn't depend on Obsidian's filesystem. Good pattern to carry forward: sync engine should similarly accept adapter interfaces rather than `app.vault` directly.
- Schema validation in `StateStore.load()` is stricter than the spec implied. Corrupted or schema-mismatched state silently triggers first-sync rather than crashing. This is the right behavior for a vault tool.

---

## Deferred to Phase 2

- Sync engine (`src/sync-engine.ts`) — the classifier matrix, pull/push logic, conflict detection.
- Per-directory `.gitignore` support (noted in ADR 002, explicitly deferred).
- Integration tests against a real GitHub repo (§11.2) — deferred until the sync engine exists to exercise.

---

## Phase 1 milestone status

All issues in the `Phase 1 — Core libs` milestone are closed except #26 (this retrospective). Closing #26 completes the milestone.
