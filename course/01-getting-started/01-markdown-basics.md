---
title: Markdown Basics
canvas_type: page
---

# Markdown Basics

All course content is written in **Markdown**, a lightweight markup language that is easy to read and write. This page demonstrates the most common formatting options.

## Text Formatting

You can make text **bold**, *italic*, or ***both***. Use ~~strikethrough~~ for deleted text and `inline code` for code references.

## Headings

Headings use `#` symbols. Use `##` for main sections and `###` for subsections. Avoid using `#` (h1) in your content since the page title already renders as h1.

## Lists

Unordered lists use dashes:

- First item
- Second item
  - Nested item
  - Another nested item
- Third item

Ordered lists use numbers:

1. First step
2. Second step
3. Third step

## Links

Link to external resources with `[text](url)`:

- [Canvas LMS Documentation](https://canvas.instructure.com/doc/api/)
- [Markdown Guide](https://www.markdownguide.org/)

## Images

Images use the same syntax as links, prefixed with `!`:

```markdown
![Alt text](path/to/image.png)
```

## Code Blocks

Use triple backticks for code blocks with optional language highlighting:

```javascript
const greeting = "Hello, world!";
console.log(greeting);
```

```python
def greet(name):
    return f"Hello, {name}!"
```

## Tables

Tables use pipes and dashes:

| Feature        | Syntax              | Example          |
| -------------- | ------------------- | ---------------- |
| Bold           | `**text**`          | **bold text**    |
| Italic         | `*text*`            | *italic text*    |
| Code           | `` `code` ``        | `code`           |
| Link           | `[text](url)`       | [a link](#)      |

## Blockquotes

Use `>` for blockquotes:

> Markdown is intended to be as easy-to-read and easy-to-write as possible.
>
> — John Gruber

## Horizontal Rules

Three dashes create a horizontal rule:

---

That covers the essentials. For a complete reference, see the GitHub Markdown Guide linked in this module.
