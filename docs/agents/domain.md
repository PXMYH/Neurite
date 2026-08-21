# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This is a **single-context** repo: one `CONTEXT.md` and one `docs/adr/` at the root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the glossary and context boundary.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

Neither exists yet, so today that means: read `CLAUDE.md` and `docs/README.md` for orientation and
carry on. Those two are architecture notes, not a glossary — they tell you how the code is wired
(script-load ordering, the Zettelkasten sync loop, the fractal coordinate system), not which domain
terms are canonical.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── js/
```

Source lives in `js/` (plus `localhost_servers/` for the optional backend), not `src/` — the ADR
directory stays at the root either way.

If this ever grows into a multi-package repo, add a root `CONTEXT-MAP.md` pointing at one `CONTEXT.md`
per context and update this file.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

Until `CONTEXT.md` exists, the code's own vocabulary is the de facto glossary: `Node`, `NodeWrap`,
`Graph`, `Fractal`, `ZettelkastenProcessor`, `AiCall`. Use those names rather than inventing
paraphrases like "card" or "canvas item".

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
