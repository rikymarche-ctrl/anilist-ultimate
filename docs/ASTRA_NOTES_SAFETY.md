# Astra reports in AniList Notes

**Append Astra Review to comment** controls generated review/Journal content in the AniList list entry's **Notes** field. It does not create social comments.

The option is off by default. With it off, generated reports stay local, while other selected list edits and explicitly edited Notes can still be synchronized. Turning it off does not remove a report already saved to AniList.

## Managed report blocks

The parser recognizes the complete Astra report heading and ending separator on their own lines. A casual mention of “Astra Review” is not a report block. Ambiguous, incomplete, nested or duplicated managed blocks stop automatic replacement instead of assuming the remaining text belongs to Astra.

A valid replacement preserves personal text outside the managed block. An empty generated report does not erase an existing remote report.

## Conflicts and pending edits

A Notes replacement carries the exact remote baseline from which it was prepared. The background rereads Notes before writing and blocks the replacement if that baseline has changed.

The check is optimistic, not an atomic server transaction: another client can still change Notes between the read and write. Unconfirmed Notes changes remain available for review rather than being blindly replayed.

Pending generated reports also recheck the current preference/local version before sending. A provider import does not overwrite local review/Journal content with an older remote report while a Notes replacement remains pending.

## Review and recovery

Use **Settings → Data recovery → Export Notes backups** and inspect both versions before retrying. Do not strip delimiters or delete personal text merely to bypass a conflict. A retry may write to AniList; it is not an undo action.

[Data and backups](DATA_AND_BACKUPS.md) · [Troubleshooting](TROUBLESHOOTING.md)
