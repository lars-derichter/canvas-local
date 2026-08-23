# Security Policy

This policy covers the **Canvas Course Builder tooling** — the CLI, the
libraries under `lib/`, the Docusaurus site, and the VS Code extension — as
published at
[lars-derichter/canvas-course-builder](https://github.com/lars-derichter/canvas-course-builder).

It does not cover the course material in a repository built from this template,
and it does not cover your Canvas instance. Problems with Canvas itself belong
with Instructure or with your institution's IT department.

## Supported Versions

Only the latest `main` is supported. Canvas Course Builder is a template you
copy rather than a package you install, so fixes reach you through
`./update-from-upstream.sh` (see
[Updating your project](docs/updating-your-project.md)) rather than through a
patch release. There are no long-lived release branches and no backports.

## Reporting a Vulnerability

Please report privately, not in a public issue:

1. Go to the
   [Security tab](https://github.com/lars-derichter/canvas-course-builder/security)
   of the project.
2. Click **Report a vulnerability**, or use
   [this direct link](https://github.com/lars-derichter/canvas-course-builder/security/advisories/new).

A useful report includes the version or commit you are on, what an attacker
could do, and the smallest set of steps that shows the problem. Include the
platform if it matters. Leave out any real credentials — see below.

If GitHub's private reporting is unavailable to you, open a public issue saying
only that you have a security report and asking for a private channel. Do not
describe the vulnerability there.

## What Happens Next

This is a single-maintainer project, so treat the following as intent rather
than a guarantee: an acknowledgement within a week, a fix on `main` once the
problem is confirmed, and a published advisory when the issue affects people who
already copied the template. You will be credited in the advisory unless you
would rather not be. There is no bug bounty.

## Handling Your Canvas API Token

The most sensitive thing this project touches is your own Canvas API token. It
acts with your full Canvas permissions — for a lecturer that means every course
you can edit, and for an admin it means considerably more.

- The token lives in `.env`, which is gitignored and is the only file in this
  project holding a credential. It does not belong in a commit. See
  [Canvas setup](docs/canvas-setup.md).
- `.canvas-sync.json` is committed on purpose and carries no credential: Canvas
  ids, your instance URL, the course id. None of that is secret, but it does
  name your institution and which course you are working on, which is worth
  knowing before you make a course repository public.
- Never paste a token into an issue, a pull request, a screenshot, or a log
  excerpt. `--verbose` output can contain request details, so read it before you
  share it.
- If a token was exposed, revoke it immediately in Canvas under **Account →
  Settings → Approved Integrations**, then generate a new one. Revoking is
  enough; you do not need to wait for anyone here.
- Give the token an expiry date when you create one, and prefer an account with
  no more access than the courses you actually sync.

## If You Created a Course From This Template

This file is the upstream project's policy, and it arrived in your repository
because GitHub copies the whole template. It stays accurate for the tooling, so
keeping it costs nothing — but if you would rather your own repository did not
advertise a security policy pointing elsewhere, see
[Files that belong to the tooling project](docs/customization.md#files-that-belong-to-the-tooling-project).
