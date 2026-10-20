# AniList Ultimate (Unofficial)

An unofficial browser extension bringing a calendar, personal ratings, Wrapped recaps and social tools together for [AniList](https://anilist.co).

## Features

- **Airing calendar:** a weekly anime schedule with layout preferences, countdowns, progress controls and friend activity.
- **Astra:** configurable scoring sections and weights, season ratings, a local Journal, list synchronization and JSON backups.
- **Astra Wrapped:** yearly, monthly or custom-period stories built from AniList list activity, with favorites, genres, studios, people and a downloadable PNG card.
- **Seasonal Wrapped:** broadcast-season rankings, personal awards, leftovers and continuing titles.
- **Friend Alerts:** a local inbox for public list updates from your chosen audience on titles you follow.
- **Activity and notifications:** feed filters, grouped notifications, scores and custom friend lists.
- **Bulk Editor:** status and custom-list edits for selected entries on your own anime/manga lists.
- **Media tools:** Following progress, available list Notes, public metadata, theme links, review scores and forum improvements.

Choose the modules you want in settings. Account features use the extension's AniList OAuth login. The Bulk Editor works for every authenticated user on their own lists and stays inactive on other people's lists.

## Screenshots

![Astra Wrapped – intro](docs/screenshots/wrapped-intro.webp)
![Astra Wrapped – binger](docs/screenshots/wrapped-binger.webp)
![Astra Wrapped – voice actors](docs/screenshots/wrapped-voice-actor.webp)
![Astra Wrapped – genres](docs/screenshots/wrapped-genres.webp)
![Astra Wrapped – journey](docs/screenshots/wrapped-journey.webp)

## Installation

Requirements: **Node.js 22.13.0 or later**, npm and Chrome 120 or later. Edge and Brave can load unpacked extensions; browser-specific login behavior can vary.

```sh
git clone https://github.com/rikymarche-ctrl/anilist-ultimate.git
cd anilist-ultimate
npm ci
npm run build
```

Open `chrome://extensions/`, enable **Developer mode**, choose **Load unpacked**, and select the generated `dist/` folder. Reload AniList tabs, then log in through the extension popup.

Install AniList Ultimate from the [Chrome Web Store](https://chromewebstore.google.com/detail/anilist-ultimate/gogibdaaglfefnemakliohebmcjfdddo) after the listing is approved. Use the [installation guide](docs/INSTALLATION.md) for updates and independent builds.

## Guides

- [User guide](docs/USER_GUIDE.md)
- [Data, backups and recovery](docs/DATA_AND_BACKUPS.md)
- [Wrapped](docs/ASTRA_WRAPPED.md) and [Seasonal Wrapped](docs/SEASONAL_WRAPPED.md)
- [Friend Alerts](docs/FRIEND_ALERTS.md) and [Bulk Editor](docs/BULK_EDITOR.md)
- [Migration from the standalone extensions](docs/MIGRATION.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Complete documentation](docs/README.md)

Friend Alerts uses a local inbox, not system push notifications. Wrapped totals depend on available logged activity and metadata rather than measured playback history. Private/hidden titles start excluded from recaps.

## Data and privacy

Astra archives, account credentials, custom friend lists, alert state and pending edits are stored locally. Interface preferences use Chrome sync storage. Changes you request are sent to AniList; public metadata panels use additional services listed in the [privacy policy](PRIVACY.md).

Export your archive before uninstalling, switching installation identity or importing. Chrome preference sync does not back up Astra data. Downloaded backups and share cards stay on your device until you choose to share them.

## Development

TypeScript, Vite 7, Manifest V3 and tsyringe.

```sh
npm run check
npm run check:coverage
npm run smoke:mv3
npm run package
```

The browser smoke check requires a compatible Chromium runtime. Packaging consumes a fresh build and produces the store-upload ZIP under `release/`; distribution identity and OAuth must be configured for the intended installation.

See [contributing](CONTRIBUTING.md), [architecture](docs/ARCHITECTURE.md), [testing](docs/TESTING.md) and [OAuth setup](OAUTH_SETUP.md).

## License

[GNU GPL version 3](LICENSE). Third-party components retain their [own licenses and notices](THIRD_PARTY_NOTICES.md).

Created by **ExAstra**. AniList Ultimate brings together the earlier calendar and hover-comment extensions. It is not affiliated with or endorsed by AniList.

[Release notes](CHANGELOG.md) · [Support](https://github.com/rikymarche-ctrl/anilist-ultimate/issues) · [Security reporting](SECURITY.md)
