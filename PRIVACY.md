# AbyssLog Privacy Notice

Last updated: 25 August 2026

AbyssLog is a local, non-commercial application. The developer does not operate
an AbyssLog account service or application server. The app does not include telemetry, advertising, or crash reporting,
and the developer does not
automatically receive your credentials, run history, or EVE Online data.

## Data stored on your device

AbyssLog stores the following data in a local SQLite database:

- EVE character IDs, names, portrait URLs, and selected ESI permissions;
- EVE OAuth access and refresh tokens;
- the Janice API key you provide;
- run history, notes, tags, systems, cargo, drones, fittings, implants,
  appraisals, appraisal items, and matching killmail IDs;
- unfinished-run checkpoints, inventory baselines, and app settings.

OAuth tokens and the Janice API key are encrypted with Electron `safeStorage`
before storage. Sign-in and secret storage are disabled when a secure
operating-system encryption provider is unavailable.

On each clean exit, AbyssLog writes a verified full database backup for the
current local date and retains the latest seven automatic backups. Manual and
before-restore backups remain until you delete them. Backups contain the same
personal data and encrypted credentials as the live database.

A restore validates a private copy, creates a safety backup of the current
database, replaces the live database, and restarts the app. Credentials restored
under another operating-system installation or user profile may not decrypt.
Reconnect the affected EVE characters and enter the Janice API key again if
needed.

## History CSV exports

History CSV files are created only when you request an export and are written to
the location you choose. A complete export can contain character identity, run
notes, systems, inventory text, fittings, implants, appraisal history, tags, and
killmail IDs. It does not contain OAuth tokens or the Janice API key.

AbyssLog does not upload CSV files. Treat them as private EVE data.

## Local diagnostics

AbyssLog keeps a privacy-filtered diagnostic event log on your device. It records
the app version, operating-system type, startup phases, failure categories, HTTP
status codes, and operation results. It does not record error messages, stack
traces, credentials, authorization URLs, character details, inventories, fits,
implants, killmails, or appraisal contents.

Diagnostic retention is seven days, limited to five files of 1 MB each. Files
are never sent automatically. In **Settings → Diagnostics**, you can open the
folder or copy a filtered summary to review before sharing it.

## Network services

AbyssLog communicates directly from your computer with:

- **EVE SSO** (`login.eveonline.com`) for sign-in, authorization-code exchange,
  and token refresh;
- **EVE ESI** (`esi.evetech.net`) for data required by the features you approve.
  Fitting capture must request the character asset list to locate the active ship.
  AbyssLog filters that response locally and stores only the captured hull,
  modules, rigs, and drones;
- **EVE Images** (`images.evetech.net`) for character portraits;
- **Janice** (`janice.e-351.com`) for item appraisals. The app sends your Janice
  key, item names, and quantities and requests non-persistent appraisals;
- **GitHub** (`api.github.com` and `github.com`) to retrieve release information
  only when you select **Check for Updates**, and to open a project or release
  link that you select.

These services receive normal connection data, such as your IP address, and
process data under their own terms and privacy policies. AbyssLog does not sell
or share data with advertisers or data brokers.

## Your choices and deletion

ESI features are optional and selected per character. You can replace an
authorization from **Settings → Permissions**. Removing a character deletes its
authorization, settings, and run history from the live database.

Deleted records can remain in existing backups. Use **Settings → Data & Recovery**
to open the backup folder and delete backups you no longer need. To remove all
local AbyssLog data, close the app and delete its database, backup, and diagnostics
folders. Uninstalling may not remove these files.

You can also revoke AbyssLog in your EVE Online account settings. Revocation
blocks future ESI access but does not delete data already stored on your device.

## Contact

For privacy questions, open a [GitHub issue](https://github.com/AbyssLog/abysslog/issues).
Do not post credentials, authorization URLs, databases, backups, CSV files, or
private EVE data. Report suspected vulnerabilities through [SECURITY.md](SECURITY.md).

Material changes to this notice will be published in this repository.
