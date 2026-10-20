# Data, backups and recovery

## Where data lives

| Data                                                       | Storage and scope                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Login token and account metadata                           | Extension local storage; not exposed through the general content-script bridge. |
| Astra ratings, Journal, seasonal choices and pending edits | Local to this extension installation/browser profile; separated by account.     |
| Custom friend lists and Friend Alerts inbox/subscriptions  | Local and account scoped.                                                       |
| Feature toggles and interface preferences                  | Chrome sync storage; browser sync depends on the user's Chrome configuration.   |
| Public metadata caches                                     | Memory or extension storage depending on the service; not an archive backup.    |
| Downloaded JSON and PNG                                    | Files on your device, outside extension storage after download.                 |

There is no extension-operated cloud backup. Synchronizing an AniList list entry does not upload the entire Astra workspace to AniList. See the [privacy policy](../PRIVACY.md).

## Export and import Astra

In Astra settings, use **Export JSON** to download the current workspace. Keep the file outside the unpacked extension folder and check that the download completed. Treat it as private: it can contain ratings, personal Notes and Journal content.

Before **Import JSON**, export the existing destination workspace. Import validates the current versioned backup format; missing versions, unsupported fields or oversized files can be rejected. The current reader has a limit of 8 Mi characters, with a separate file-size check in the file picker. Do not edit schema numbers to force an old backup through validation.

An Astra backup is not an export of the login token, all preferences, Friend Alerts inbox, custom friend lists or the durable pending-edit queue. Those have separate scopes; the recovery panel offers dedicated pending-change and Notes-backup exports.

## Offline and pending edits

A locally accepted edit can be queued until AniList is available. Pending records belong to the account that created them. Restarting the worker does not mean they were sent. A server failure or a Notes conflict may require review rather than endless automatic retries.

Open extension settings → **Data recovery**. Use **Refresh**, inspect records, and **Export pending changes** before **Retry selected**. **Export Notes backups** provides the retained Notes safety records. A recovery export is a review aid; there is no general queue-import UI documented here.

Retry is not undo. It can write to AniList. Compare the intended edit with the current remote entry first, especially after changing the same entry elsewhere.

## Notes and the generated Astra report

The generated report is a managed block inside AniList list-entry Notes. The **Append Astra Review to comment** switch controls automatic report generation, not all explicitly edited Notes.

The writer checks the remote Notes against the baseline used to prepare a replacement. An ambiguous report or a changed remote baseline can block writing and preserve the pending record. The check reduces conflicts but is not an atomic server transaction: another client can still write after the read.

Do not delete personal text or strip report delimiters merely to make a retry pass. Export the Notes backup, inspect both versions and resolve the content deliberately. [Technical Notes safeguards](ASTRA_NOTES_SAFETY.md).

## Local workspace and accounts

**Export local Astra** reads the current local workspace. **Copy local Astra to account** is an explicit action with account/session checks and a required empty target. It does not import arbitrary historical storage or merge accounts automatically.

Removed unnamespaced archives and old queue/list formats are not read or migrated. Original unsupported records are preserved where the runtime rejects them. [Supported data formats](BACKUP_FORMATS.md).

## Logout, reset and removal

Logout removes the access token; it is not an archive deletion. Uninstalling removes the installation's extension storage. Reset operations can remove data in their stated scope. Export first and keep the original installation intact until the new one has been checked.

A different browser profile, extension ID or separate old extension has different local storage. Chrome preference sync alone cannot recover your Astra ratings. [Migration guide](MIGRATION.md).
