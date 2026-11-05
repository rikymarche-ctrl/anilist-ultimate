# User guide

## Login and settings

Log in through the extension popup. Website login and extension login are separate. Check the account before editing a list. Feature switches are in extension settings; the calendar also has its own layout controls. Disabled modules stop their feature UI, but existing stored data is not an automatic backup or deletion.

## Airing calendar

The home-page calendar groups airing anime by day. Choose the available layout, first day, empty-day behavior and time display in calendar settings. Progress controls update your AniList entry through the extension's sync path. A countdown is a schedule indicator, not a guarantee that an episode is available on a streaming service.

If the calendar requests authentication or cannot load data, use the displayed login/retry control. [Troubleshooting](TROUBLESHOOTING.md).

## Astra ratings and Journal

Open Astra from the extension's AniList navigation entry. The dashboard supports searching, filtering, sorting and editing tracked works. Scoring sections and weights are configurable. Ratings are calculated from sections; the removed manual-score override is not a supported editing mode.

Use the rating/Quick Edit interface for the available list fields, season ratings, dates and Journal. Review the save result. Local persistence and successful AniList synchronization are different steps: an offline edit can remain pending. Raising the progress of a title not on your list, or of one on Planning from zero, sets it to Watching or Reading and fills an empty start date with today. Closing the form reloads the page once AniList has a status change. Delete entry appears whenever anything is stored for the title, also only in Astra: it empties Astra and then AniList and succeeds only if both are removed, otherwise the Astra data comes back and you can retry.

The **Append Astra Review to comment** setting controls generated content in the AniList entry's **Notes** field. It is off by default. Turning it off does not erase a report already on AniList, and explicitly edited Notes can still be sent. [Notes and recovery](DATA_AND_BACKUPS.md).

## Wrapped

Open **Astra → Wrapped**, then choose a recap.

- **Astra Wrapped:** AniList list activity for this year, this month or custom dates, with Astra score overrides and privacy flags. The period is based on logged activity dates; it does not reconstruct all viewing from local Journal notes.
- **Seasonal Wrapped:** anime grouped by broadcast season, with concluded titles, continuing shows, leftovers and personal awards. Completed titles receive final scores; a continuing show's final ranking belongs to its concluding season.

Use the arrows or progress segments to navigate. Playback pauses on interactive slides; reduced-motion preferences disable autoplay. Each recap offers **Download PNG**. Private/hidden titles are excluded initially; inspect the recap and share card before sharing if you enable them. PNG files are downloaded locally, not published automatically.

See [Astra Wrapped calculations](ASTRA_WRAPPED.md) and [seasonal rules](SEASONAL_WRAPPED.md).

## Friend Alerts

On an anime/manga page, select the square bell beside the native list-status action. Choose people you follow or a custom friend-list audience. Read updates on **Notifications → Friend alerts**; manage subscriptions under **Following**.

This is a local inbox for public progress/status activity, not push notifications, likes, replies or private list changes. Background checks are scheduled every five minutes while the browser runs; provider errors and pagination can delay collection. The newest 200 alerts are retained. [Full details](FRIEND_ALERTS.md).

## Notifications, feed and social tools

Notification Cleaner groups consecutive compatible notifications and adds filtering. Reply rows show the reply itself as plain text, matched to the row by order, so an unusual thread can show a different reply from the same person. Notifications from the same person about the same activity appear as one row with a note, such as "also liked your activity". A like on a reply joins a reply row only when both show the same text, so different replies in a thread stay separate. A deleted activity may leave its original notification text without extra details.

Activity tools add feed filters and score/context information (Activity Feed and Activity Score switches). Social features (Social Activity switch) include custom audiences, Following progress, avatar overlays and note tooltips. Hover Comments reads list Notes where AniList exposes them; it does not make private information available. User lists created inside the extension are distinct from AniList's anime/manga custom lists.

Profile Social covers follower counts, banner actions and people in common on user profiles. On someone else's anime or manga list, **Astra compare** (under AniList's Compare with your list) opens a long comparison story: head-to-head figures, shared titles, score affinity and habits, disagreements, genres, themes, formats, people in common, who got there first, what to try next, every title side by side and a downloadable card. Your private entries are left out, and a private list shows a clear message instead. It has its own **Astra Compare** switch in the extension settings; see [ASTRA_COMPARE.md](ASTRA_COMPARE.md).

**Following groups.** On a title's Social tab you can split the Following column into groups. Open the custom lists settings, check the lists you want as groups and order them with the arrows. Each user goes to the first checked list that contains them; everyone else goes to Others, which is always last. Groups have no user limit and can be collapsed from their header. Members AniList has not loaded yet are added to their group. On the title's Overview the Following box keeps its five rows: group members come first, and the viewer's followings and group members for that title are read once per visit when a group has members. This is a local display preference: nothing changes on AniList.

Media pages can show public metadata, review scores and opening/ending theme links. These depend on external services and may be unavailable without affecting your local Astra archive.

## Bulk Editor

Every authenticated user can use the editor on their own anime/manga lists. The extension account must match the list owner; the editor stays inactive on somebody else's list or while signed out.

Hold a title briefly to select it, choose **Edit selected**, and change status or custom-list membership. Keyboard selection starts with **Shift+Space** on a focused title. Saves are sequential and can partially succeed; inspect the result before retrying. [Scope and limits](BULK_EDITOR.md).

## Backups and account changes

Export Astra JSON from Astra settings before reinstalling, resetting, switching browser profiles or importing. Chrome sync settings do not include the Astra archive. Logout removes credentials; local account workspaces are kept separate rather than transferred to the next user.

Read [data and backups](DATA_AND_BACKUPS.md) before recovery, and [migration](MIGRATION.md) when replacing older extensions.
