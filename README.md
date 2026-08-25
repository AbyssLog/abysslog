# AbyssLog

A local EVE Online Abyssal Deadspace run tracker with ESI integration, inventory
comparison, Janice appraisals, searchable history, and statistics.

[Changelog](CHANGELOG.md) · [Statistics reports](docs/statistics-reports.md) ·
[Architecture](docs/architecture.md) · [Privacy](PRIVACY.md) ·
[Security](SECURITY.md) · [Support](SUPPORT.md) · [License](LICENSE)

## Features

- **Automatic or manual tracking:** ESI can detect Abyssal entry and exit, with
  a configurable polling interval that defaults to five seconds.
- **Inventory comparison:** compare cargo and drones before and after a run,
  infer tier and weather from a recognized filament, and reuse the last survived
  inventory or a saved loadout preset.
- **Janice appraisals:** value gained items at buy prices and consumed items at
  replacement prices while retaining unpriced item names in History.
- **Loss handling:** detect capsule exits, capture authorized fits and implants,
  and replace estimated losses with verified killmail contents when available.
- **Searchable History:** combine free-text search across run details, tags, and
  gained, consumed, or lost item names with structured filters.
- **Versioned CSV:** export the current History filters and import complete 1.2
  History files. Duplicate run UIDs are skipped.
- **Statistics:** review survival and ISK summaries, build Run Performance or
  Item Drops reports, and open the matching runs in History.
- **Captured fits:** group equivalent hull, module, drone, and implant setups,
  then assign an optional display name without changing historical snapshots.
- **Multiple characters and recovery:** keep permissions, history, and active
  state per character, and recover unfinished runs after a restart.
- **Local data controls:** create and restore full database backups, inspect
  privacy-filtered diagnostics, and store credentials with operating-system
  encryption.

## Getting started

### Download

Download the Windows installer from [GitHub Releases](https://github.com/AbyssLog/abysslog/releases/latest).
Releases are not code signed, so Windows may show a SmartScreen warning. Compare
the installer hash with the included `SHA256SUMS.txt` before running it.

Unsigned Windows, macOS, and Linux preview artifacts are available from
[GitHub Actions](https://github.com/AbyssLog/abysslog/actions). They are intended
for testing and expire after 14 days.

### Connect an EVE character

AbyssLog includes its EVE OAuth client configuration. In **Settings**, select
**Add Character**, choose the ESI features you want, and approve those permissions
in your browser:

- **Automatic run tracking** reads the current solar system and active hull type.
- **Ship fitting loss capture** reads character assets and the active hull type.
- **Implant loss capture** reads the active clone's implants.
- **Killmail loss reconciliation** reads recent killmails after a death.

Permissions are stored per character and can be changed later. Manual run entry
remains available when no optional ESI features are selected.

### Add a Janice API key

AbyssLog does not include a shared Janice key. Request a key through the
[Janice Discord](https://discord.gg/janice), then save and test it in **Settings**.

### Record the first run

1. Open **Settings** and save a Janice API key.
2. Add an EVE character, or use manual entry without ESI.
3. Open **Tracker**.
4. Paste the pre-run cargo and drone contents.
5. Start the run manually, or let ESI detect entry.

## Run workflow

1. **Awaiting:** enter the pre-run inventory. A recognized filament sets the
   tier and weather.
2. **In Abyss:** the timer runs after manual start or confirmed ESI entry.
3. **Survived:** stop the run, enter the post-run inventory, appraise the result,
   review it, and save.
4. **Died:** AbyssLog checks for an Abyssal killmail and appraises the recorded
   loss. If the killmail is delayed or unavailable, it uses the captured pre-run
   inventory, fit, and implants as an estimate.

After a survived run, the post-run cargo and drones become the next pre-run
baseline. Clear or replace that baseline after unloading, restocking, or changing
drones.

Use **Manage** under Pre-Run Contents to save a loadout from pasted cargo and
drone lists. A preset stores only item names and quantities. Applying one replaces
both pre-run inventories and still performs filament inference.

ESI character assets can be cached for up to one hour, so AbyssLog does not use
them to detect real-time cargo changes during a run.

## Building from source

Supported Node.js versions are 22.22.2 or later in the 22.x line, 24.15.0 or
later in the 24.x line, and 26 or later.

```bash
git clone https://github.com/AbyssLog/abysslog.git
cd abysslog
npm ci
npm run setup
npm start
```

`npm run setup` downloads the pinned Electron runtime. Dependency lifecycle
scripts are disabled by default in `.npmrc`.

Build commands:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

Run `npm run check` before submitting a change. It checks architectural boundaries
and runs the complete test suite. Use `npm run test:coverage` for a coverage report.

## Publishing a Windows release

Public releases use immutable GitHub releases and unsigned Windows installers.
Set the same version in `package.json`, `package-lock.json`, and `version.json`,
merge the release commit into `main`, then create and push a matching annotated tag:

```bash
git tag -a v1.2.2 -m "AbyssLog v1.2.2"
git push origin v1.2.2
```

The release workflow:

1. verifies the tag and its position on `main`;
2. installs dependencies, runs tests, and audits production dependencies;
3. builds and smoke-tests the unsigned Windows installer;
4. generates SHA-256 checksums;
5. creates a draft GitHub release.

Download and test the draft installer, verify its checksum, review the generated
notes and assets, then publish the draft manually.

## Data storage

The SQLite database is stored in the application data directory:

- **Windows:** `%APPDATA%\abysslog\abysslog.db`
- **macOS:** `~/Library/Application Support/abysslog/abysslog.db`
- **Linux:** `~/.config/abysslog/abysslog.db`

OAuth tokens and the Janice API key are encrypted with Electron `safeStorage` and
stored in the credentials table. Sign-in and credential storage are disabled if
a secure operating-system provider is unavailable.

On each clean exit, AbyssLog writes a verified automatic backup for the current
local date. A later clean exit on the same date replaces that day's automatic
backup. The latest seven automatic backups are retained. Manual and before-restore
backups remain until you delete them.

Restore accepts complete schema-v6 AbyssLog databases only. It validates a private
copy, creates a safety backup of the current database, replaces the live database,
and restarts the app. Credentials restored under another operating-system account
may not decrypt and must then be entered again.

Local diagnostics are retained for seven days and limited to five files of 1 MB
each. They contain operational categories and status codes, not error messages,
credentials, or EVE data, and are never sent automatically.

See the [privacy notice](PRIVACY.md) for retention, network, export, and deletion
details.

## EVE Online notice

AbyssLog is an independent third-party application and is not affiliated with or
endorsed by Fenris Creations.

The [EVE Online Developer License Agreement](https://developers.eveonline.com/license-agreement)
requires this notice:

© 2014 CCP hf. All rights reserved. “EVE”, “EVE Online”, “CCP”, and all related
logos and images are trademarks or registered trademarks of CCP hf.

## License

AbyssLog-authored software and documentation are available under the
[MIT License](LICENSE). That license does not grant rights to EVE Online game
data, third-party material, or trademarks. See [NOTICE.md](NOTICE.md).
