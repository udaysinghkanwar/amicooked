# Releasing

## What happens on each push

| You push | What runs | What changes for students |
|---|---|---|
| A commit to `main` | Tests on macOS, Windows and Linux. Vercel redeploys `site/`. | The website and the install script, right away. The app itself doesn't change. |
| A tag like `v0.1.4` | The release workflow, below. | A new version of the app, on GitHub and npm. |

So site and installer fixes ship on every push to `main`. App changes only ship when you tag a release.

## Cutting a release

From a clean `main` that's in sync with GitHub:

```bash
npm version patch          # or minor; runs the tests, bumps every version number, commits "chore: vX.Y.Z" and tags it
git push --follow-tags     # pushes the commit and the tag together
```

The tag starts `.github/workflows/release.yml`:

1. **release**: checks the tag matches `package.json`, builds the four binaries and publishes the GitHub release with checksums. It skips the tests: `npm version` already ran them, and the push to `main` runs them on all three systems. The curl and PowerShell installers pick this up immediately.
2. **npm**: publishes the same version to npm, only after step 1 succeeded. It skips itself if that version is already on npm, so re-running a failed workflow is safe.

Then check it worked:

```bash
gh run watch                    # follow the workflow
npm view amicooked version      # should show the new version
```

The app and the full `skill/` folder ship as one version. Before releasing, run `npm test` (build, unit tests and Node/native CLI smoke tests); check `node dist/cli.js features` and an upgrade from the previous release. Add a feature's reference to `skill/references/` and its catalog entry to `src/feature-catalog.json`. Keep release notes clear about what users can do, optional requirements and any breaking changes: `amicooked update` uses the GitHub release notes to explain updates. There is no separate skill-content release channel.

Updates download the latest stable GitHub release (or the matching npm version), refresh installed skills and leave login/client configuration alone. npm publication follows the binary release; an npm update during that short gap may fail and should be retried after publication completes. On Windows, if another process prevents replacing the executable, close the AI apps using it and retry. The native updater retains the old executable as `.previous`.

## Which number to bump

While the version starts with `0.`:

- `patch` (0.1.3 → 0.1.4): fixes and small additions. Most releases.
- `minor` (0.1.x → 0.2.0): changes someone might notice break things, like renamed `--clients` options or tool output that's shaped differently.

Students on npm run `amicooked@0`, so they get every `0.x` release automatically. Keep it working for them.

## One-time setup: npm trusted publishing

The workflow publishes without a stored npm token. Set this up once on npmjs.com:

1. Open https://www.npmjs.com/package/amicooked/access.
2. Under **Trusted Publisher**, choose **GitHub Actions** and enter:
   - Organization or user: `udaysinghkanwar`
   - Repository: `amicooked`
   - Workflow filename: `release.yml`
3. Save.

Until this is set up, the `npm` job fails. The GitHub release still goes out; publish to npm by hand with `npm publish` from the repo.

## If something goes wrong

- **The tests or build fail:** nothing was published. Fix it on `main`, delete the tag (`git tag -d vX.Y.Z && git push origin :vX.Y.Z`), and release again.
- **The GitHub release worked but npm failed:** fix the cause, then re-run the failed job from the Actions tab.
- **A bad version is out:** don't reuse its number (npm never allows it). Release a fixed patch on top.

The site telemetry endpoint must be deployed before a CLI release that adds event types. Upgrade counts use the existing Redis integration; no new credentials or migration are required. Existing setup/site keys remain unchanged.
