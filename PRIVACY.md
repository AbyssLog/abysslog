# AbyssLog Privacy Notice

Last updated: 28 July 2026

AbyssLog is a locally installed, non-commercial hobby project. The developer does
not operate an AbyssLog account service or application server, and the app does
not include telemetry, advertising, or crash reporting. The developer does not
automatically receive your run history, credentials, or EVE Online data.

## Data stored on your device

AbyssLog stores the following data in its local SQLite database:

- EVE character IDs, names, portrait URLs, and selected ESI permissions;
- EVE OAuth access and refresh tokens;
- the Janice API key you provide;
- run history, notes, cargo and drone text, appraisals, fittings, implants, and
  matching killmail IDs;
- unfinished-run checkpoints, inventory-baseline state, and app settings.

OAuth tokens and the Janice API key are encrypted with Electron `safeStorage`
before they are stored. AbyssLog disables sign-in and secret storage if a secure
operating-system-backed encryption provider is unavailable.

The app creates one full local database backup per day while it is open and
retains the latest seven automatic backups. Manual backups are retained until
you delete them. Backups contain the same personal data and encrypted credentials
as the live database.

## Local diagnostics

AbyssLog keeps a privacy-filtered diagnostic event log on your device. It records
the app version, operating-system type, startup phases, failure categories, HTTP
status codes, and whether specific local operations succeeded. It does not record
error messages, stack traces, OAuth tokens, API keys, authorization URLs,
character details, cargo, drones, fittings, implants, killmails, or appraisal
contents.

Diagnostic files are limited to five files of 1 MB each and are deleted after
seven days. They are never sent automatically. **Settings → Diagnostics** lets
you open the folder or manually copy a filtered summary to the clipboard so you
can review it before sharing it in a support request.

## Network services

AbyssLog communicates directly from your computer with:

- **EVE SSO** (`login.eveonline.com`) to sign you in, exchange authorization
  codes, and refresh OAuth tokens;
- **EVE ESI** (`esi.evetech.net`) to retrieve only the character data needed by
  the features and permissions you selected. The optional fitting feature must
  request your character's asset list to locate the active ship; AbyssLog filters
  that response locally and stores only the captured active ship, modules, rigs,
  and drones;
- **EVE Images** (`images.evetech.net`) to display character portraits;
- **Janice** (`janice.e-351.com`) to appraise item names and quantities. Your
  Janice API key is sent to Janice with these requests, and AbyssLog requests
  non-persistent appraisals;
- **GitHub** (`raw.githubusercontent.com` and `github.com`) to check the published
  AbyssLog version and to open project or release links you select.

These independent services receive network information such as your IP address
and process data under their own terms and privacy policies. AbyssLog does not
sell or share data with advertisers or data brokers.

## Your choices and deletion

ESI-powered features are optional. You select their permissions per character
and can replace that authorization from **Settings → Permissions**. Removing a
character deletes that character, its authorization, and its run history from
the live database.

Deleted records can remain in existing backups. Use **Settings → Data & Recovery**
to open the backup folder and delete backups you no longer want. To remove all
local AbyssLog data, close the app and delete its database, backup, and diagnostics
folders; uninstalling the app may not remove that data automatically.

You can also revoke AbyssLog from your EVE Online account settings. Revocation
prevents future ESI access but does not delete data already stored on your
computer.

## Contact

For general privacy questions, open a
[GitHub issue](https://github.com/AbyssLog/abysslog/issues). Do not include
OAuth tokens, API keys, database files, backups, or private EVE data in a public
issue. Report suspected security vulnerabilities using the private process in
[SECURITY.md](SECURITY.md).

Material changes to this notice will be published in this repository.
