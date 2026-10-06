# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Before exploring, read these

- `GLOSSARY.md` at the repo root when it exists.
- `docs/adr/` entries relevant to the area being changed when they exist.

If these files do not exist, proceed silently. Create them only when a domain term or durable architectural decision has been resolved.

## File structure

This is a single-context repository:

```text
/
├── GLOSSARY.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

Use the terms defined in `GLOSSARY.md` in issues, designs, tests, and refactoring proposals. If a needed term is missing, reconsider whether the project already uses another term or record the gap for domain modelling.

## Flag ADR conflicts

Explicitly surface any conflict with an existing ADR rather than silently overriding it.
