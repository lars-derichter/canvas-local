# Hosting Your Course on the Web

Your course content lives as markdown and is served locally by Docusaurus with
`npm start`. You can also publish it as a public website on **GitHub Pages** for
free. This gives your students a stable URL to read the materials, handy as a
fallback when Canvas is unavailable.

The website only contains your `course/` folder. The `evaluations/` and
`sources/` folders are never built into the site, so your exam materials stay
out of the public version even though they live in the same repository.

## Public Site, Private Repository

The published website is **public**: anyone with the link can read it. Your
repository stays **private**, so your source files, exam materials, and Canvas
credentials are not exposed.

> [!IMPORTANT]
>
> GitHub Pages on a **private** repository requires a paid plan (GitHub Pro or
> higher). Educators and students get GitHub Pro for free through
> [GitHub Education](https://education.github.com). Apply there first if you
> haven't already.

## Setting It Up

Publishing is a repository setting, not a command. On GitHub, go to **Settings >
Pages** and set **Source** to **GitHub Actions**. That is the whole setup.

From then on, every push to your default branch rebuilds and republishes the
site. The workflow that does it, `.github/workflows/deploy.yml`, ships with the
project and needs no editing. GitHub Pages tells it which address your
repository publishes to, so it builds the site for
`https://YOUR-USERNAME.github.io/your-project-name/` without anything being
written into `docusaurus.config.js`. That is also why an upstream update can
never send your site to the wrong address.

Watch the first run under the **Actions** tab. When it finishes, your site is
live.

Until you switch Pages on, the workflow still starts on every push, sees that
publishing is off, and skips the build. A course that never publishes collects
skipped runs rather than failed ones.

## Using Your Own Domain

If you own a domain and want to use it instead of the `github.io` address, enter
it under **Settings > Pages** and point your domain's DNS at GitHub Pages.
Nothing in your repository changes: the deploy workflow reads the domain back
from GitHub, so the next push builds the site for it, and no `CNAME` file is
involved. See
[GitHub's custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site).

## Troubleshooting

If the deploy fails, open the failed run under the **Actions** tab to read the
log. The most common cause is a **broken link**: the site is configured to fail
the build on broken internal links (`onBrokenLinks: 'throw'` in
`docusaurus.config.js`), so a wrong link path stops the deploy. Run
`npm run build` locally to catch the same error before pushing.

If a run succeeds but nothing is published, and every job after the first is
greyed out as skipped, Pages is not enabled yet or its source is still set to a
branch. Set **Source** to **GitHub Actions** and push again.

If every job is green, the deploy step ends in `Reported success!`, and the
address still shows GitHub's own "Site not found" page, the publish hung after
the build rather than in it. Ask GitHub how far the deployment got:

```bash
gh api repos/YOUR-USERNAME/your-project-name/pages/deployments/COMMIT-SHA
```

A status of `purging_cdn` that does not change within a few minutes means the
site is stuck on GitHub's side. Re-running the workflow usually clears it. If it
does not, set **Settings > Pages > Source** to **None**, save, set it back to
**GitHub Actions**, and push again.
