# AniList OAuth setup

This guide is for maintainers and people building an independent copy. Users of a correctly configured distributed extension only need the login action in the popup.

## How the current login works

The background service uses AniList's OAuth implicit grant through `chrome.identity.launchWebAuthFlow`. It generates a random `state`, checks the returned origin/path and state, and stores credentials in trusted extension local storage. Content-script API requests go through the background.

The source fallback client ID is `35100` in `src/core/auth/AuthService.ts`; `VITE_ANILIST_CLIENT_ID` can override it at build time.

The authorization request sends the client ID, `response_type=token` and state. It relies on the redirect registered on the AniList client; adding a different redirect to the request is not the documented fix.

## Configure your own build

1. Build and load `dist/`, then open `chrome://extensions/`.
2. Note the extension ID. Open its service-worker inspector.
3. Evaluate `chrome.identity.getRedirectURL()` in that extension context. Copy the returned URL exactly, including its path/trailing slash.
4. Open [AniList developer settings](https://anilist.co/settings/developer) and create or edit an OAuth client you own.
5. Set that client's redirect to the URL obtained above.
6. In an ignored `.env.local`, set the public client identifier:

```dotenv
VITE_ANILIST_CLIENT_ID=your_client_id
```

7. Rebuild, reload the extension and AniList tabs, then test login from the popup.

The client ID is public configuration. Do not add a client secret or access token to any `VITE_` variable; these values become part of the compiled browser code. Do not change the shared maintainer-owned client for an independent fork.

## Extension identity and distribution

The source manifest's `key` pins the unpacked development ID. The release ZIP generator removes that field from its manifest copy and leaves `dist/manifest.json` unchanged. The store installation has the ID assigned to its store item; verify it rather than assuming it matches development.

Before publishing, upload the intended package, obtain the store item/extension ID, and configure the AniList client for that identity. If development and production IDs differ, separate OAuth clients avoid changing one registered redirect back and forth. Build with the client intended for the package.

Use the browser's actual `getRedirectURL()` result when possible. Do not replace or remove the development key merely to troubleshoot a login on an existing installation: a different ID can mean different local storage. [Backups](docs/DATA_AND_BACKUPS.md).

## Firefox build

AniList accepts one redirect per client, so Firefox needs its own client. Firefox derives the redirect from the add-on ID (`anilist-ultimate@exastra`, fixed in `vite.config.ts`):

```
https://38edd18e5a15a955d99ff3789eb7197b37e7eb97.extensions.allizom.org/
```

1. Create a second AniList client with exactly that redirect.
2. Put its ID in an ignored `.env.firefox.local` as `VITE_ANILIST_CLIENT_ID=...` (mode files override `.env`).
3. `npm run build:firefox && npm run package:firefox` → `release/anilist-ultimate-firefox-<version>.zip`.

`build:firefox` prints a warning while the Chromium client ID is still in use. Never change the add-on ID after the first AMO upload: it changes the redirect and the storage of existing installs.

## Verify and diagnose

Test successful login, cancellation followed by retry, logout while login is pending, an account switch and a second AniList tab. Confirm the displayed account after login and after a worker restart.

Use chrome.identity.getRedirectURL() in the extension context to obtain the redirect. An invalid redirect or state must not be fixed by disabling validation.

Never paste an OAuth callback URL, token or raw auth storage into an issue. Use the diagnostic code and a redacted description. [Troubleshooting](docs/TROUBLESHOOTING.md).

Reference: [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity). Source behavior is implemented in `AuthService.ts`; test scenarios are described in [testing](docs/TESTING.md).
