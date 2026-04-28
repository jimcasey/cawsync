# ADR 001 — MIT License

**Status:** Accepted
**Date:** 2026-04-28
**Decider:** Jim Casey

## Decision

Jackdaw is released under the MIT License. See `LICENSE` in the repository root.

## Context

The project needed a license before any code was written. Three options were considered: MIT, AGPLv3, and Apache 2.0.

## Rationale

**MIT was chosen because:**
- The Obsidian plugin ecosystem skews MIT. Contributors and company-employed developers can use or contribute to MIT code without legal review.
- Jackdaw depends on Obsidian (closed-source) and GitHub's API (third-party SaaS). AGPL's copyleft and network-use protections are largely theoretical — any fork would still depend on the same closed services, limiting the practical protection AGPL would offer.
- Apache 2.0's explicit patent grant adds little value given the plugin's implementation surface (no novel algorithms, no hardware interaction, no patentable mechanisms).
- MIT has the lowest friction for adoption and contribution, which matters more than fork protection in this ecosystem.

## Consequences

Anyone may fork, embed, or commercialize Jackdaw without restriction. A closed-source commercial fork is theoretically possible. This is considered an acceptable risk given the ecosystem norms and the plugin's dependency on closed platforms.
