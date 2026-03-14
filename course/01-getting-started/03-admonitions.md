---
title: Admonitions
canvas_type: page
---

# Admonitions

Admonitions are colored callout boxes that draw attention to important information. This project supports GitHub-style blockquote alerts, which work in both Docusaurus and Canvas.

## Syntax

Admonitions use the blockquote alert syntax:

```markdown
> [!NOTE]
> This is a note.
```

## Available Types

> [!NOTE]
> Use **NOTE** for supplementary information that adds context. The reader can skip this without missing essential content.

> [!TIP]
> Use **TIP** for practical advice and best practices. These help the reader work more efficiently.

> [!IMPORTANT]
> Use **IMPORTANT** for key information the reader must know to succeed. Do not skip these.

> [!WARNING]
> Use **WARNING** when something could go wrong. Warns about potential pitfalls or common mistakes.

> [!ATTENTION]
> Use **ATTENTION** for critical alerts. This type signals that ignoring the message could lead to serious problems.

> [!CHECK]
> Use **CHECK** to highlight verification steps or success criteria. Useful for checklists and validation points.

## Tips for Using Admonitions

- Use admonitions sparingly. Too many callout boxes make content harder to scan.
- Pick the type that matches the intent, not the color you prefer.
- Keep the text inside concise. If it needs multiple paragraphs, consider making it regular content instead.
- Admonitions are converted to styled HTML when pushed to Canvas, with icons hosted on your Canvas instance.
