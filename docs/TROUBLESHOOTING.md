# Troubleshooting

## Login fails or returns to an unexpected page

- Sign in through the extension popup, even if AniList is already signed in.
- Check the selected AniList account in the authorization window.
- Cancel a stuck authorization, reload the extension and AniList tab, then try again.
- On an independent build, the AniList client must have the redirect matching that build's extension ID. Follow [OAuth setup](../OAUTH_SETUP.md); users of a distributed build should report the error rather than modify somebody else's developer app.
- Record the displayed diagnostic code. Never share an access token or an authorization callback URL containing a token.

## Calendar, Astra or social controls are missing

Check that the relevant module is enabled, that the page is one it supports, and that extension login succeeded. Reload AniList tabs after reloading the extension. Disable the two predecessor extensions while testing Ultimate to avoid duplicate controls. The Bulk Editor requires the extension account to match the owner of the list you are viewing.

For an unpacked build, check `chrome://extensions/` for a loading error and confirm that you selected compiled `dist/`, not the source root.

## Changes save locally but AniList is not updated

Check the account and connection, then inspect **Settings → Data recovery**. Export pending changes before reviewing a retry. Keep the local archive; reinstalling can remove the evidence and unsent edits.

A Notes conflict is different from an offline error. Compare the current remote Notes and the preserved baseline. Retrying must not be used to overwrite unrelated personal text.

## Wrapped is empty or totals differ

Astra Wrapped uses dated AniList list activity, with provider limits, merged updates and missing-history limitations. Logging a range later attributes it to that logged date. Current scores are not a historical score timeline. Private/hidden titles start excluded.

Seasonal Wrapped uses broadcast-season attribution, not everything you watched that season. Recoveries, continuing titles and uncertain viewing dates are treated separately. [Astra](ASTRA_WRAPPED.md) · [Seasonal](SEASONAL_WRAPPED.md).

## Friend Alerts is delayed

Verify the title subscription, selected audience, extension account and **Friend Alerts** switch. Checks are scheduled at five-minute intervals while the browser runs. Opening the inbox does not force another API call; manual checks share the minimum interval. Busy audiences may need several cycles. Private edits and activity AniList does not publish cannot appear. [Collection limits](FRIEND_ALERTS.md).

## Import is rejected or data appears missing

Check the selected account/profile/extension ID. Export the current workspace before doing anything else. The current backup schema is validated strictly, and legacy formats are not converted by changing a version number. Do not reset storage to fix an import error. [Backup and recovery](DATA_AND_BACKUPS.md).

## Themes or public media metadata fail

Provider downtime, removed metadata and rate limits can leave a panel empty. Try later. These lookups do not require resetting your local archive or sharing credentials.

## Report a reproducible problem

Open a [bug report](https://github.com/rikymarche-ctrl/anilist-ultimate/issues) with:

- Extension version, browser/version, operating system and installation method.
- Relevant page type and enabled module.
- Steps, expected behavior, actual behavior and displayed error code.
- A redacted screenshot and whether reloading changed the result.

Do not attach raw storage, personal backup files, full request headers, private Notes, full OAuth URLs or console dumps without checking them. Vulnerabilities belong in the [security reporting process](../SECURITY.md).
