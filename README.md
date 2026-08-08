# AbyssLog

EVE Online Abyssal Deadspace run tracker with ESI integration, cargo diffing, and Janice price appraisals.

[Privacy](PRIVACY.md) · [Security](SECURITY.md) · [Support](SUPPORT.md) · [License](LICENSE)

## Features

- **ESI auto-detection** — polls every 5 seconds, auto-starts/stops timer on abyssal entry/exit
- **Ship loss detection** — detects pod on exit, triggers loss appraisal automatically
- **Optional fitting & implant capture** — captures authorized loss details at run start for loss valuation
- **Optional killmail reconciliation** — replaces estimated death losses with the ship, cargo, drones, and implants recorded by ESI
- **Cargo diffing** — paste pre/post cargo, app diffs to separate loot gained from items consumed
- **Filament inference** — recognizes the filament in pre-run cargo and selects its tier and weather
- **Remembered inventory baseline** — carries a survived run's post-run cargo and drones into the next run
- **Loadout presets** - save, edit, and apply reusable cargo and drone inventories using item names and quantities only
- **Janice appraisals** — prices loot at instant-sell (buy orders) and consumed items at replacement cost (sell orders)
- **Run history** — filterable, sortable table with editable runs and re-appraisal previews that can be saved or discarded
- **Statistics** — survival rate, death-adjusted profit/hour, average profit, losses, and breakdowns by tier and weather
- **Statistics ranges** - view all time, rolling last hour, today, recent-day, current-month, or custom-date results
- **Multi-character** — add multiple characters, switch between them
- **Run recovery** — checkpoints unfinished runs locally and restores them after a restart

---

## Getting Started

### 1. Download

Download Windows installers from the [GitHub Releases page](https://github.com/AbyssLog/abysslog/releases/latest). Releases currently are not code signed, so Windows may show a SmartScreen warning. Each release includes `SHA256SUMS.txt`; verify the installer's SHA-256 hash before running it.

Unsigned preview builds for Windows, macOS, and Linux are available from the [GitHub Actions page](https://github.com/AbyssLog/abysslog/actions). Preview artifacts expire and are intended for testing.

### 2. EVE Online Sign-In

AbyssLog includes its EVE OAuth client configuration. Use **Add Character** in Settings, choose the features you want, and approve their ESI permissions in the browser:

- **Automatic run tracking** reads the current solar system and active ship type.
- **Ship fitting loss capture** reads character assets and the active ship type.
- **Implant loss capture** reads the active clone's implants.
- **Killmail loss reconciliation** reads recent killmails after a death.

These choices are stored per character. You can change them later with **Permissions** in Settings. Selecting no optional features leaves manual run entry available without ESI data access.

### 3. Janice API Key

Janice API keys are available by filing a ticket in the [Janice Discord](https://discord.gg/janice).

### 4. First Run

1. Open AbyssLog
2. Go to **Settings**
3. Paste your **Janice API Key**, click Save
4. Click **Add Character** and log in via EVE SSO
5. Head to the **Tracker** tab — you're ready

---

## Run Workflow

1. **Awaiting** — paste your pre-run cargo hold contents. A recognized filament selects the tier and weather automatically.
2. **In Abyss** — ESI detects entry, timer starts automatically
3. **Survived** — ESI detects exit, timer stops. Paste post-run cargo, click **Appraise Loot**, review, click **Save Run**
4. **Died** — ESI detects pod, then checks for an Abyssal killmail and appraises the recorded loss. Killmails can take several minutes to appear, so **Check Killmail** is available for a retry. Without that permission or a matching killmail, the app falls back to the pre-run cargo, fitting, and implant estimate.

After saving a survived run, your post-run cargo and drone bay are automatically promoted to the next run's pre-run baseline. Clear or replace that baseline after docking to unload loot, restock, or change drones.

Use **Manage** under Pre-Run Contents to create a preset from pasted cargo and drone lists. Applying a preset replaces both pre-run fields, ignores price/category columns, and still performs filament inference.

ESI character assets can be cached for up to an hour, so they are not used to detect real-time cargo changes during a run.

---

## Building from Source

Requires Node.js 22.12+.

```bash
git clone https://github.com/AbyssLog/abysslog.git
cd abysslog
npm ci
npm run setup      # download the pinned Electron runtime
npm start          # run in dev mode
npm run build:win  # build Windows .exe
npm run build:mac  # build macOS .dmg
npm run build:linux # build Linux .AppImage
```

Dependency lifecycle scripts are disabled by default in `.npmrc`. `npm run setup` is the explicit, reviewable step that downloads the Electron runtime.

---

## Publishing a Windows Release

Windows releases are currently unsigned. Enable immutable releases in the
repository settings before the first public release. Update both `package.json`
and `version.json` to the same version, merge and validate the change on `main`,
then create and push a matching annotated tag:

```bash
git tag -a v1.0.1 -m "AbyssLog v1.0.1"
git push origin v1.0.1
```

The release workflow:

1. verifies that the tag matches both version files;
2. requires an annotated tag whose commit is already part of `main`;
3. runs tests and audits production dependencies;
4. builds and smoke-tests the unsigned Windows installer;
5. creates SHA-256 checksums for the release assets;
6. creates a draft GitHub release for manual installation testing and review.

After testing the exact draft asset and comparing its hash with
`SHA256SUMS.txt`, manually publish the draft release. The release workflow never
publishes a release automatically.

Use the complete [release checklist](RELEASE_CHECKLIST.md) for privacy review,
upgrade testing, repository hardening, draft inspection, and post-publication
verification.

---

## Data Storage

Run history is stored in a local SQLite database at:
- **Windows:** `%APPDATA%\abysslog\abysslog.db`
- **macOS:** `~/Library/Application Support/abysslog/abysslog.db`
- **Linux:** `~/.config/abysslog/abysslog.db`

OAuth tokens and the Janice API key are encrypted with Electron `safeStorage` before they are written to the local database. AbyssLog disables sign-in and credential storage when a secure OS-backed provider is unavailable; credentials are never persisted with the insecure plaintext/basic-text fallback.

While the app is open, one verified full-database backup is created per local day and the latest seven automatic backups are retained. Use **Settings → Data & Recovery** to create a manual backup, open the backup folder, or restore a full `.db` backup. Restore validates the selected database, preserves the current database as a retained before-restore backup, replaces the live data, and restarts AbyssLog.

A full restore replaces rather than merges the current database. Credentials encrypted by a different operating-system installation or user profile may no longer decrypt after a restore; reconnect affected EVE characters and re-enter the Janice API key.

The app also keeps privacy-filtered local diagnostic events for seven days,
bounded to five 1 MB files. These events contain operational categories and
status codes rather than error messages or EVE data, and they are never sent
automatically. Use **Settings → Diagnostics** to open the folder or copy a
reviewable support summary.

See the [privacy notice](PRIVACY.md) for the complete local-data, external-service,
retention, and deletion details.

---

## EVE Online Notice

AbyssLog is an independent third-party application and is not affiliated with or
endorsed by Fenris Creations.

The current [EVE Online Developer License Agreement](https://developers.eveonline.com/license-agreement)
requires this proprietary notice:

© 2014 CCP hf. All rights reserved. “EVE”, “EVE Online”, “CCP”, and all related
logos and images are trademarks or registered trademarks of CCP hf.

---

## License

AbyssLog-authored software and documentation are released under the
[MIT License](LICENSE). The license does not grant rights to EVE Online game
data, third-party material, or trademarks. See [NOTICE.md](NOTICE.md).
