# Installation and updates

## Requirements

The source manifest requires Chrome 120 or later. Use an updated desktop Chromium browser. Edge and Brave can load unpacked extensions, but browser-specific OAuth and installed-build flows must be checked separately. Firefox and mobile installation are not documented as supported.

An AniList account and an internet connection are needed for account features. Signing in on the AniList website does not sign you in to the extension.

## Build from source

Install Node.js 22.13.0 or later and npm. From a terminal:

```sh
git clone https://github.com/rikymarche-ctrl/anilist-ultimate.git
cd anilist-ultimate
npm ci
npm run build
```

Load the resulting `dist/` folder through **Load unpacked**. Do not select the repository root, `src/`, or `public/`: those are not the compiled extension.

An independent build may need its own AniList developer client and registered redirect URL. [OAuth setup](../OAUTH_SETUP.md) explains that maintainer task. Ordinary users of a correctly configured distributed build do not need to create a developer app.

## First use

1. Open the extension popup and select the AniList login action.
2. Check the AniList account shown in the authorization window and authorize the app.
3. Return to AniList and reload the page if it was already open.
4. Open extension settings to choose modules and calendar preferences.
5. Open Astra from the extension's AniList navigation entry to use ratings and Wrapped.

See the [user guide](USER_GUIDE.md) for individual features and [troubleshooting](TROUBLESHOOTING.md) for failed login.

## Update an unpacked installation

1. Export your Astra archive and review pending changes before replacing an installation.
2. Keep the same installation folder and extension identity where possible.
3. Replace the compiled files with the new build, press **Reload** on the existing extension card, and reload every AniList tab.
4. Check login, settings and your archive before making edits.

Uninstalling or loading a build with a different extension ID creates a different storage situation. Do not expect local archives or preferences to transfer automatically. Keep the source/build folder on disk while the unpacked extension uses it.

A separate unpacked installation does not automatically become a store installation. [Migration and backups](MIGRATION.md).
