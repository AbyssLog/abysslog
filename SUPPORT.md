# AbyssLog Support

AbyssLog is a free hobby project maintained by one person. Support is best effort,
with no guaranteed response or resolution time.

## Asking for help

Search [GitHub Issues](https://github.com/AbyssLog/abysslog/issues) before opening
a new report. For a reproducible problem, include:

- the AbyssLog version and operating system;
- whether the app came from a release, CI preview, or source build;
- the steps that caused the problem;
- the expected and actual results;
- a redacted screenshot or exact error message, when useful.

Use **Settings → Diagnostics → Copy Diagnostics** to copy a filtered summary.
Review it before sharing. The summary includes app and operating-system versions
and bounded operational events. It does not include error messages, credentials,
authorization URLs, character details, inventories, or stack traces.

Do not upload an AbyssLog database, backup, or History CSV export. Do not post
OAuth tokens, Janice API keys, authorization URLs, or private character data.
Use test data or redact sensitive values.

## Where to report an issue

- App defects and feature requests: [GitHub Issues](https://github.com/AbyssLog/abysslog/issues)
- Suspected vulnerabilities: [Security Policy](SECURITY.md)
- EVE account, game-client, or enforcement questions: EVE Online Support
- ESI availability: EVE developer or community status channels
- Janice access or pricing: Janice support

## Data recovery

In **Settings → Data & Recovery**, select **Restore from Backup**. AbyssLog
validates the backup, preserves the current database as a safety backup, replaces
the live database, and restarts.

After reinstalling the operating system, reconnect any EVE characters and enter
the Janice API key again if the restored credentials cannot be decrypted.
