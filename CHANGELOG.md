# Release notes

## 1.0.4

### Firefox

- Native Firefox version (Firefox 140 or later), built from the same source as the Chrome version with `npm run build:firefox`.
- Firefox uses its own AniList login client and redirect; the Chrome login is unchanged.
- Fixed Firefox-only issues: content scripts not loading, background start-up, extension pages rejected by the message router, Font Awesome icon errors and a purple box under the Astra navbar link.

### Calendar

- The weekly schedule is kept for the browser session, so reloading AniList shows the calendar without waiting for a new collection read. It is bound to the signed-in account and invalidated by pending or completed edits.
- The first calendar load uses a priority lane in the shared AniList request queue.

### Notifications

- Comment likes from the same person stay in one group.
- Grouped time ranges read "54 minutes – 1 hour ago" and no longer overlap the notification text.

### Build

- `npm run release` builds and packages both store archives and lints the Firefox package.

## 1.0.3

### Quick Edit

- Quick Edit asks once whether to score by sections or with a single score; the choice can be changed anytime in the Astra settings under Scoring Mode, and it is remembered for every entry.
- The Quick Edit window now sizes to its content: a single score or a few sections no longer leave empty space, and the radar only takes room when it is drawn.

### Security

- Update Vitest, its UI and V8 coverage provider to 4.1.12, including the patched mocker tooling for [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp).
- Update undici (used by jsdom in tests) to 7.30.1 for [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) and [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c).
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
