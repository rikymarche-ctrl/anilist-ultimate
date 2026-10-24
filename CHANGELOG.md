# Release notes

## Unreleased

### Security

- Update Vitest, its UI and V8 coverage provider to 4.1.12, including the patched mocker tooling for [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp).
- Fix the test UI command to use Vitest's supported API host option while keeping the server bound to localhost.

## 1.0.2

- Added custom Following groups on title pages and a navbar unread badge for Friend Alerts.
- Made Astra sync, scoring, notes and Quick Edit more reliable and easier to use.
- Improved Following progress updates, including automatic completion at the episode total.
- Kept background sync working across service worker restarts and unpacked rebuilds.

## 1.0.1

Beta listing package metadata for the Chrome Web Store.

## 1.0.0

Initial public source distribution of AniList Ultimate.

- Weekly airing calendar and progress controls.
- Configurable Astra scoring, season ratings, Journal and JSON backups.
- Yearly/custom-period Astra Wrapped and Seasonal Wrapped, with PNG exports.
- Friend Alerts, activity filters, notification grouping and social tools.
- Bulk editing of status and custom-list membership on each user's own lists.
- Public media metadata, theme links, review and forum enhancements.

Installation, account login and data handling are described in the [documentation](docs/README.md).
