# Security reporting

Use this process to report vulnerabilities affecting AniList Ultimate.

## Reporting a vulnerability

Use **Security → Report a vulnerability** on the GitHub repository if private vulnerability reporting is enabled. Do not publish exploit details, access tokens, private Notes, user archives or raw storage in a public issue.

If a private reporting button is not available, open a minimal issue asking the maintainer for a private contact channel, without disclosing the vulnerability or affected personal data. No dedicated security email or response-time guarantee is currently advertised.

Useful information includes the affected version/commit, browser, feature, preconditions, minimal reproduction and impact. Use synthetic accounts/data and redact any identifiers not needed for the report. Do not test against another person's account.

## Scope and updates

Reports about authentication, account isolation, extension messaging, unsafe rendering, backup parsing, pending writes and data exposure are welcome. The project does not currently promise maintenance of historical releases or the two predecessor extensions. Check for a published update and keep backups when updating installations.

Security reports are evaluated against the affected source version. Automated checks do not replace reviewing account and provider integration.

## Sensitive information already exposed

Remove access from the affected provider where possible and revoke an exposed AniList authorization. Deleting a screenshot or commit alone does not revoke a credential. Keep details out of public follow-up messages and arrange a private channel.

For ordinary data/import errors, use [troubleshooting](docs/TROUBLESHOOTING.md) and [backup guidance](docs/DATA_AND_BACKUPS.md).
