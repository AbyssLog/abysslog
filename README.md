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

Go to the [Actions tab](../../actions) on GitHub, click the latest successful build, and download the artifact for your platform:
- **Windows** — `AbyssLog-Windows` → `.exe` installer
- **macOS** — `AbyssLog-macOS` → `.dmg`
- **Linux** — `AbyssLog-Linux` → `.AppImage`

### 2. EVE Developer App

You need a free EVE developer application to use ESI login.

1. Go to [developers.eveonline.com](https://developers.eveonline.com)
2. Create a new application with these settings:
   - **Callback URL:** `abysslog://callback`
   - **Scopes:**
     ```
     esi-location.read_location.v1
     esi-location.read_ship_type.v1
     esi-location.read_online.v1
     esi-fittings.read_fittings.v1
     esi-clones.read_implants.v1
     ```
3. Copy the **Client ID** — you'll paste it into AbyssLog Settings

### 3. Janice API Key

Janice API keys are available by filing a ticket in the [Janice Discord](https://discord.gg/janice).

### 4. First Run

1. Open AbyssLog
2. Go to **Settings**
3. Paste your **Client ID** and **Janice API Key**, click Save
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

Requires Node.js 18+.

```bash
git clone https://github.com/YOUR_USERNAME/abysslog
cd abysslog
npm install
npm start          # run in dev mode
npm run build:win  # build Windows .exe
npm run build:mac  # build macOS .dmg
npm run build:linux # build Linux .AppImage
```

---

## Data Storage

Run history is stored in a local SQLite database at:
- **Windows:** `%APPDATA%\abysslog\abysslog.db`
- **macOS:** `~/Library/Application Support/abysslog/abysslog.db`
- **Linux:** `~/.config/abysslog/abysslog.db`

Tokens are stored in your OS keychain via `keytar` — they never touch disk in plaintext.
