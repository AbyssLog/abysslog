# Security Policy

## Supported versions

Security fixes are provided for the latest published AbyssLog release. Preview
artifacts and older releases are not separately supported; users should update
to the latest release after reviewing its release notes and checksum.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through
[GitHub Private Vulnerability Reporting](https://github.com/AbyssLog/abysslog/security/advisories/new).
Do not open a public issue for an undisclosed vulnerability.

If that private form is unavailable, open a public issue that contains only a
request to establish private contact. Do not identify the affected component,
describe the vulnerability, or include reproduction details in that issue.

Include:

- the affected AbyssLog version and operating system;
- clear reproduction steps and the expected security impact;
- a minimal proof of concept, if one is safe to share;
- whether the issue has been disclosed anywhere else.

Never include live EVE OAuth tokens, Janice API keys, database backups, or another
person's data. Use test credentials and redact screenshots and logs.

This is a volunteer-maintained hobby project, so no response-time guarantee is
offered. Reports will be acknowledged and assessed on a best-effort basis.
Please allow a reasonable remediation period before public disclosure.

## Other reports

General defects, feature requests, ESI outages, and Janice outages should use
[GitHub Issues](https://github.com/AbyssLog/abysslog/issues). Windows
SmartScreen warnings are expected while releases are unsigned; verify the
download against the release's `SHA256SUMS.txt`.
