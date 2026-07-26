# AbyssLog

EVE Online Abyssal Deadspace run tracker with ESI integration, cargo diffing, and Janice price appraisals.

## Features

- **ESI auto-detection** — polls every 5 seconds, auto-starts/stops timer on abyssal entry/exit
- **Ship loss detection** — detects pod on exit, triggers loss appraisal automatically
- **Fitting & implant capture** — captures ship fit and pod implants at run start for loss valuation
- **Cargo diffing** — paste pre/post cargo, app diffs to separate loot gained from items consumed
- **Janice appraisals** — prices loot at instant-sell (buy orders) and consumed items at replacement cost (sell orders)
- **Run history** — filterable, sortable table with net ISK and total loss columns
- **Statistics** — survival rate, ISK/hour, avg net ISK, avg loss on death, breakdown by tier and weather
- **Multi-character** — add multiple characters, switch between them

---

## Getting Started

### 1. Download

Download production Windows installers from the [GitHub Releases page](https://github.com/AbyssLog/abysslog/releases/latest). Release builds are required to be Authenticode signed and include `SHA256SUMS.txt` so the downloaded files can be verified.

Unsigned preview builds for Windows, macOS, and Linux are available from the [GitHub Actions page](https://github.com/AbyssLog/abysslog/actions). Preview builds are intended for testing, not normal installation.

### 2. EVE Online Sign-In

AbyssLog includes its EVE OAuth client configuration. Use **Add Character** in Settings and approve the requested ESI scopes in the browser.

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

1. **Awaiting** — paste your pre-run cargo hold contents, select tier and weather
2. **In Abyss** — ESI detects entry, timer starts automatically
3. **Survived** — ESI detects exit, timer stops. Paste post-run cargo, click **Appraise Loot**, review, click **Save Run**
4. **Died** — ESI detects pod, loss is appraised automatically from pre-run cargo + fitting + implants. Click **Save Run**

After saving a survived run, your post-run cargo is automatically promoted to pre-run cargo for the next run.

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

Production Windows releases are built from version tags and must be Authenticode signed. Enable immutable releases in the repository settings. Configure a protected GitHub environment named `release`, require a reviewer, and add these environment secrets:

- `WIN_CSC_LINK` — a base64-encoded `.pfx` code-signing certificate
- `WIN_CSC_KEY_PASSWORD` — the certificate password

Protect the `v*` tag pattern in the repository settings. Update both `package.json` and `version.json` to the same version, merge and validate the change on `main`, then create and push a matching annotated tag:

```bash
git tag -a v1.0.1 -m "AbyssLog v1.0.1"
git push origin v1.0.1
```

The release workflow:

1. verifies that the tag matches both version files;
2. requires an annotated tag whose commit is already part of `main`;
3. runs tests and audits production dependencies;
4. refuses to build without signing credentials;
5. verifies and timestamps every packaged Authenticode signature;
6. publishes the installer, update metadata, and SHA-256 checksums to GitHub Releases.

The signing certificate and password must only exist in GitHub secrets; never add either one to the repository.

---

## Data Storage

Run history is stored in a local SQLite database at:
- **Windows:** `%APPDATA%\abysslog\abysslog.db`
- **macOS:** `~/Library/Application Support/abysslog/abysslog.db`
- **Linux:** `~/.config/abysslog/abysslog.db`

OAuth tokens and the Janice API key are encrypted with Electron `safeStorage` before they are written to the local database. AbyssLog disables sign-in and credential storage when a secure OS-backed provider is unavailable; credentials are never persisted with the insecure plaintext/basic-text fallback.
