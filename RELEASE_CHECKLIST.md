# AbyssLog Release Checklist

Use this checklist for each public Windows release. Releases are unsigned and
are always created as drafts first.

## 1. Prepare the release candidate

- [ ] Finish the intended scope and leave unrelated work for a later release.
- [ ] Confirm the working tree is clean and `main` is synchronized with
      `origin/main`.
- [ ] Set the same semantic version in `package.json`, `package-lock.json`, and
      `version.json`.
- [ ] Review the complete diff since the previous release or, for the first
      release, the complete repository.
- [ ] Confirm no credentials, databases, backups, diagnostics, local build
      output, or personal information are tracked.

## 2. Verify quality and dependencies

- [ ] Run `npm ci`.
- [ ] Run `npm test`.
- [ ] Run `npm audit --omit=dev --audit-level=high`.
- [ ] Review every open Dependabot alert, including development-only alerts,
      and record why any accepted alert cannot affect the shipped application.
- [ ] Confirm the latest `main` CI run passes on Windows, macOS, and Linux.
- [ ] Build the unsigned Windows installer and run the packaged-application
      smoke test.

## 3. Test data safety and upgrades

- [ ] In the current installed version, create a manual backup from
      **Settings → Data & Recovery** and copy it outside the application data
      directory.
- [ ] Install the release candidate over the previous public version.
- [ ] Confirm existing characters, settings, run history, and remembered
      inventory baseline are retained.
- [ ] Confirm an unfinished run is recovered after restarting the application.
- [ ] Export run history to CSV, import it into a disposable character, and
      confirm duplicate rows are skipped.
- [ ] On a disposable profile, restore the copied database backup while the
      application is closed and confirm it opens successfully.

## 4. Complete functional checks

- [ ] Add a character through EVE SSO and choose a minimal permission set.
- [ ] Change that character's permissions and confirm disabled features remain
      unavailable.
- [ ] Save and test a Janice API key.
- [ ] Complete a manually entered survived run.
- [ ] Complete automatic entry and exit tracking.
- [ ] Check no drone loss, partial drone loss, docking/unloading, and clearing
      the remembered inventory baseline.
- [ ] Check the death fallback and killmail reconciliation paths.
- [ ] Open **Settings → Diagnostics**, select **Copy Diagnostics**, and confirm
      the copied text contains no credentials or character, inventory, or
      error-message data.

## 5. Prepare GitHub for publication

- [ ] Keep the repository private until the release candidate and history have
      passed the privacy review.
- [ ] Enable immutable releases before publishing the first release.
- [ ] Make the repository public.
- [ ] Enable secret scanning and push protection.
- [ ] Enable CodeQL default setup and Private Vulnerability Reporting.
- [ ] Protect `main` with a repository ruleset or branch protection that blocks
      force pushes and deletions and requires the CI status checks. Do not
      require another person's approval for this single-maintainer project.
- [ ] Confirm Actions has read-only default workflow permissions and cannot
      approve pull requests.
- [ ] Confirm Actions requires full commit-SHA pinning.
- [ ] Confirm the `release` environment permits only `v*` tags.
- [ ] Confirm repository Actions secrets and variables are empty unless a
      documented release change requires one.

## 6. Create and inspect the draft release

Create an annotated tag only after the release commit is on `main`:

```bash
git tag -a v1.0.0 -m "AbyssLog v1.0.0"
git push origin v1.0.0
```

- [ ] Confirm the Release workflow succeeds.
- [ ] Confirm the resulting GitHub release is still a draft.
- [ ] Download the installer and `SHA256SUMS.txt` from the draft.
- [ ] Verify the installer's SHA-256 checksum.
- [ ] Install that exact downloaded asset on a clean Windows profile.
- [ ] Install it over the previous public version and repeat the critical
      upgrade checks.
- [ ] Review generated release notes for private information, internal details,
      and clarity.
- [ ] Confirm the draft contains only the installer, update metadata, blockmap,
      and checksum file expected for the release.

## 7. Publish and verify

- [ ] Publish the reviewed draft release manually.
- [ ] Confirm the release is marked immutable.
- [ ] Confirm the release appears at
      `https://github.com/AbyssLog/abysslog/releases/latest`.
- [ ] From an older installed version, select **Check for Updates** and confirm
      the new version and release link appear.
- [ ] Download the public installer once more and verify its checksum.
- [ ] Watch the first issue reports and GitHub security alerts after launch.

If a release must be withdrawn, never replace assets silently under the existing
version. Explain the issue publicly, use GitHub's supported release-removal
controls only if necessary, and publish the fix under a new version and tag.
An immutable tag name must not be reused.
