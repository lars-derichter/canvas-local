# QTI 1.2 Package Format for Canvas Import

Read this before generating the package. The zip layout Canvas expects:

```
<ident>.zip
├── imsmanifest.xml
└── <ident>/
    └── <ident>.xml
```

`<ident>` is a unique id, e.g. the slug plus a timestamp.

## imsmanifest.xml

An IMS CP 1.1 manifest with one `<resource>` of `type="imsqti_xmlv1p2"` whose
`href` and `<file>` point at `<ident>/<ident>.xml`.

## Assessment XML

`<questestinterop>` → `<assessment title="…">` → one `<section>` → one `<item>`
per question. Per item:

- `<qtimetadata>` with fields `question_type` (see the table in SKILL.md) and
  `points_possible`.
- The question text in `<presentation>` → `<material>` →
  `<mattext texttype="text/html">` (HTML-escaped inside).
- Choices as `<response_lid>`/`<render_choice>`: single cardinality for multiple
  choice and true/false, multiple for multiple answers. `<response_str>` with
  `<render_fib>` for short answer and essay. Numerical answers via a
  `<response_str>` plus `<varequal>`/range conditions.
- `<resprocessing>` with an `<outcomes>` `SCORE` decvar (maxvalue 100) and
  `<respcondition>`s that `<setvar>` SCORE to 100 for the correct response. For
  multiple answers, one `<and>` condition requiring all correct choices and
  `<not>` on the others. Essay items get no scoring condition.
