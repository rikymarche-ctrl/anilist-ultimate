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

## Anime and manga pages

**Collapsible sections.** Click the chevron or the heading of a section on an anime or manga page to collapse it; click again to open it. Each section remembers its state.

**Watch Order & Map.** On anime pages, the section after Relations shows the whole franchise.

- **Watch order** lists the titles in order with episode ranges, air dates and your progress; the next title to watch is highlighted. The line above the list gives the number of titles, total episodes, movies and runtime, and the bar on its right counts what you have watched.
- **Default order** / **Release dates** switches between the watch order and air dates. **Show specials** / **Hide specials** includes or leaves out specials and music videos. **Hide watched** / **Show watched** hides or shows completed titles. These apply to the AniList order, not to a curated one.
- **Map** draws the franchise as a graph: drag to move, use the controls to zoom, fit or go full screen, and click the minimap to jump. With a curated order, **Curated order** / **Default order** switches between the AnimeChrono line and the AniList relations layout.
- **Curated orders.** AnimeChrono publishes community-curated orders. The extension reads one only when you open that franchise page on animechrono.com yourself (the section offers a button for it); the order is then kept locally and credited under the list.

**Opening and ending ratings.** Off by default. In Astra settings → Global Preferences, turn on **Rate openings and endings**, then choose right below it, for Openings and for Endings, a score section (or sub-section), which takes the mean of your song ratings, or **Not counted**, which keeps the ratings out of the score and tags their sliders "Not counted". Openings and endings cannot use the same section. Each song then has its own slider on the anime page, and when you raise your progress to the first episode of a new opening or ending (from ranges such as "eps 14-25") the progress popup shows a slider for it beside the notes field; songs already rated are not asked again. A list never set up shows a reminder instead of sliders. Turning the switch off hides everything and keeps the ratings already given. After changing these settings on an anime page, closing Astra reloads the page so its sliders follow. They are never written to your AniList notes.

## Bulk Editor

Every authenticated user can use the editor on their own anime/manga lists. The extension account must match the list owner; the editor stays inactive on somebody else's list or while signed out.

Hold a title briefly to select it, choose **Edit selected**, and change status or custom-list membership. Keyboard selection starts with **Shift+Space** on a focused title. Saves are sequential and can partially succeed; inspect the result before retrying. [Scope and limits](BULK_EDITOR.md).

## Backups and account changes

To move to another browser, open extension settings → Advanced → **Backup** and use **Export backup**; in the new browser, **Import backup** restores preferences, custom user lists, Astra and song ratings, then restarts the extension. Sign in again afterwards: the login is not in the file. Astra settings still offer **Export JSON** for the Astra archive alone. Chrome sync settings do not include the Astra archive. Logout removes credentials; local account workspaces are kept separate rather than transferred to the next user.

Read [data and backups](DATA_AND_BACKUPS.md) before recovery, and [migration](MIGRATION.md) when replacing older extensions.
