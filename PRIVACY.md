# Privacy Policy

**AniList Ultimate (Unofficial)** · Last updated: 2026-10-28

## Summary

AniList Ultimate (Unofficial) is a browser extension for Chrome and Firefox by [ExAstra](https://anilist.co/user/ExAstra/) that enhances [anilist.co](https://anilist.co). It is not affiliated with or endorsed by AniList.

- Astra archives, account credentials, pending edits and custom Following group display settings are stored on your device. Interface preferences use the browser's sync storage and may sync through your browser account.
- Your AniList account is used to read lists, activity and social metadata, and to save the list edits you request on AniList.
- The extension has no analytics or telemetry, shows no advertising, and does not sell your data. Requests to AniList and the public metadata providers are described below.
- The Back Restore feature keeps a bounded, tab-scoped record of AniList page URLs, list filters and scroll positions so it can restore a page when you go back. It does not access the browser's general browsing history.

User data obtained through the extension is used for its AniList features. The extension does not use it for advertising, data brokerage or unrelated profiling. This policy describes behavior; it is not a claim of Chrome Web Store approval.

## Data stored locally

The extension stores the following in the browser's extension storage.

**Local storage (`chrome.storage.local`)** stays on this device. In Chrome, access is restricted to the extension's trusted contexts; Firefox has no equivalent setting, so there the restriction is enforced by the extension's own code. In both browsers the extension's content scripts on anilist.co use it only through a fixed list of allowed keys, which never exposes credentials, and web pages cannot read it. It holds:

- Your AniList access token, your AniList user ID and your AniList user name
- Astra ratings, notes, Journal entries, sections, seasonal awards and backups
- Your custom user lists
- Names, ordering and collapsed state for your custom Following groups
- Friend alert state
- A pending sync queue of list edits that have not yet been sent to AniList
- Short-lived caches of public AniList data

**Sync storage (`chrome.storage.sync`)** holds extension settings and preferences only, such as feature toggles and interface preferences. The browser may sync this area across your own signed-in browsers (Chrome sync or Firefox Sync). It holds no account data.

**Session storage (`chrome.storage.session`)** is kept in memory and cleared when the browser closes. It holds a cached public index of AnimeThemes video IDs and the last weekly calendar schedule of the signed-in account (titles, airing times and your list progress), so the calendar can show immediately after a page reload. The schedule is bound to the account and login session that saved it, expires after 30 minutes, is replaced when you edit an entry, and is readable only by the extension's background context.

**AniList tab storage (`window.sessionStorage`)** is separate from extension storage. Back Restore keeps up to 25 snapshots in memory and mirrors them to the AniList tab's session storage. Each snapshot contains an AniList path and query string, capture time, scroll offset, loaded-content count and applicable list-filter values. These snapshots are used only to restore your page on Back/Forward navigation. They are not sent to the developer or metadata providers. AniList scripts share access to that origin's tab storage. The browser controls its lifetime and may preserve it when restoring a browsing session; clearing AniList site data removes it. Disabling Back Restore stops further captures.

**Memory-only caches** can contain viewer-dependent list, social, notification and review data. Notification Cleaner can read activity text and the body/privacy flag of an AniList message that AniList makes available to the authenticated account, to render notification context. These details are cached in memory, rather than persistent extension storage, and account changes clear those private caches. Wrapped separately reads received-message metadata without requesting message bodies.

## Network requests

Programmatic API and metadata requests use these hosts declared in the manifest:

- **anilist.co and graphql.anilist.co (AniList).** Used for:
  - Logging in with AniList's OAuth implicit grant, through the browser's `identity.launchWebAuthFlow`, with a random `state` value that the extension checks on return.
  - AniList GraphQL API calls made with your access token, to read your lists, activity, notes, notification/message context and social data and to save list entries you edit (`SaveMediaListEntry` and `DeleteMediaListEntry`). Wrapped reads list activity, media/cast/staff data, engagement counts, participant profiles and received-message metadata. Its social query does not request post or message bodies; Notification Cleaner does request accessible activity/message text for notification context. Wrapped results can be cached in memory for the current account/session and period.
- **jikan.lucashdo.com (community Jikan / MyAnimeList mirror).** Public metadata and score lookups. Requests contain only a MyAnimeList numeric ID, or an anime title for an exact-title search.
- **api.tenrai.org.** Opening and ending theme lists. Requests contain only a MyAnimeList numeric ID.
- **toshy.github.io (public AnimeThemes tracker index).** Requests contain no user data.

Your AniList access token is sent only to AniList. Requests to the other hosts are sent without credentials and without a referrer, and they never include your AniList token or identity.

The interface and local share-card renderer can also load public cover, avatar, staff and character images from the image URLs returned by providers. Those image hosts receive the browser's ordinary network request, including its IP address. Account tokens are not added to those image URLs.

Links you click, such as YouTube searches, AnimeThemes and anichart.net, open in a new tab as ordinary browser navigation. They are subject to the destination's own policy.

## What we don't do

- No analytics or telemetry.
- No advertising.
- No sale of user data and no transfer for advertising, data brokerage or unrelated profiling. Network transfers are limited to the feature-related requests described above.
- No remote code. The extension runs only scripts packaged with it (Content Security Policy `script-src 'self'`).
- Content-script access is limited to AniList by the manifest; additional host permissions support the metadata services listed above. Fonts used by the extension pages are bundled with the extension.
- No access to the browser's general browsing history and no tracking across unrelated websites. The bounded AniList navigation snapshots described above remain in the tab and support Back Restore. Scroll and filter state are used for that feature; the extension does not record a general click stream or the text of arbitrary keystrokes.

## Limited use

AniList Ultimate's use of user data complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Data is used only to provide or improve the disclosed AniList features. It is not used or transferred for personalized advertising, creditworthiness or lending decisions. The developer does not receive automatic copies of your local archive, tokens, messages or navigation snapshots and does not have a service for reading them. If you choose to send information in a support request, share only the information you intend the developer to inspect. Data transfers needed to operate the features are described in the Network requests section.

## Your choices

- **Logout:** logging out from the extension popup removes the stored access token.
- **Uninstall:** uninstalling the extension deletes all of its extension storage data.
- **Back Restore data:** clear AniList site data to remove the tab-storage snapshots as well; this is separate from the extension's storage and uninstall behavior.
- **Revoke access:** you can revoke the app's access to your AniList account in AniList under Settings → Apps.
- **Export and recovery:** the extension's settings page includes data export and recovery.
- **Sharing:** JSON backups and Wrapped PNGs are saved to your device. They are not posted automatically and may contain personal content if you include it. Files you have downloaded are not deleted by uninstalling the extension.
- **Private titles:** Wrapped excludes known private/hidden titles initially. Choosing to include them can put them in your exported card. This display filter does not prevent authenticated data loading or anonymize social participants.

Logout does not erase all account workspaces. Local archives, pending edits and alert state are retained until removed through their relevant controls or by uninstalling. Temporary caches may expire or be replaced independently. Edits already saved to AniList remain on AniList; deleting extension data does not delete those remote entries.

Detailed export scopes and recovery limits are described in [Data and backups](docs/DATA_AND_BACKUPS.md).

## Changes

Policy updates are published in this file in the repository. The "Last updated" date at the top shows the most recent change.

## Contact

To ask a question or raise a concern, open an issue on the [GitHub repository](https://github.com/rikymarche-ctrl/anilist-ultimate).
