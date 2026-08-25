# Security Policy

## Supported versions

Security fixes are provided for the latest published AbyssLog release. Preview
artifacts and older versions are not separately supported.

## Reporting a vulnerability

Report suspected vulnerabilities through
[GitHub Private Vulnerability Reporting](https://github.com/AbyssLog/abysslog/security/advisories/new).
Do not open a public issue with vulnerability details.

If the private form is unavailable, open a public issue that contains only a
request to establish private contact. Do not identify the component, describe
the vulnerability, or include reproduction details.

Include the following in the private report:

- the affected AbyssLog version and operating system;
- reproduction steps and the expected security impact;
- a minimal proof of concept, when safe;
- any previous disclosure of the issue.

Never include live OAuth tokens, Janice API keys, database backups, History CSV exports,
or another person's data. Use test credentials and redact screenshots
and logs.

AbyssLog is maintained as a hobby project, so response and remediation times are
not guaranteed. Please allow time for a fix before public disclosure.

## Other reports

Use [GitHub Issues](https://github.com/AbyssLog/abysslog/issues) for app defects
and feature requests. Use EVE or Janice support channels for service outages.
Windows SmartScreen warnings are expected while releases are unsigned. Verify
downloads against the release `SHA256SUMS.txt` file.
