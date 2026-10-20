# Bulk Editor

Every authenticated user can edit their own anime/manga lists. The editor activates only when the account connected to the extension matches the owner of the list route, including filtered sublists. It remains inactive on another person's list and for signed-out visitors.

Enable the List Editor module in settings.

## Select entries

Hold a title for about half a second to start selection. A short ordinary click continues to open a title before selection mode begins. Moving, scrolling, releasing early or losing focus cancels a pending hold.

In selection mode, click rows/titles to toggle them. **Select visible** includes loaded rows shown by the current filter, deduplicating repeated entries. Individual selections can remain when a filter hides their rows; the count/preview identifies this.

For keyboard selection, focus a title and use **Shift+Space** to begin, then **Space** to toggle rows. **Exit** or **Escape** leaves selection while no operation is running. Page/type/account changes retire the selection.

## Edit and confirm

Choose **Edit selected**. Status is optional. Each custom list offers keep, add or remove, using that media type's current AniList list names. The editor does not create/rename lists, change tags/Notes/progress/dates/ratings or delete entries.

**Apply changes** shows a confirmation naming the chosen changes and entry count. Changing fields or selection requires a new confirmation. Review it before submitting.

## Save, stop and retry

The service rereads the collection before saving and sends only selected fields. Entries are saved sequentially, so a run can partially succeed.

**Stop** prevents subsequent requests after the current request finishes. It cannot undo a request already sent. Saved entries are confirmed from provider responses; unconfirmed entries remain selected.

A user stop, an Astra-sync pause and a provider/network failure have different messages. A pending Astra edit or a changed queue revision can pause the batch to reduce conflicts. These checks are not an atomic lock against every other browser/provider client.

Review the result before retrying. Retry rereads entries and avoids resending already satisfied changes. An unconfirmed last request may already have reached AniList. Use the offered list refresh after confirmed changes rather than assuming the native page refreshed itself.

[User guide](USER_GUIDE.md) · [Troubleshooting](TROUBLESHOOTING.md)
