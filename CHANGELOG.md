# Release notes

## 1.2.0

### Profiles

- New **Astra Compare**: on someone else's anime or manga list, under AniList's Compare with your list, a long Wrapped-style story compares the two lists: head-to-head figures, shared titles, score affinity and habits, disagreements, genres, themes, formats, people in common, who got there first, what to try next and a downloadable card. Your private entries are left out, and a private list shows a clear message instead. It has its own switch in the extension settings.

### Settings

- The Social Activity switch now really turns off the social panels, Following progress and groups, the calendar's friend data and the social buttons on cards. Before, these ignored it.
- New switches: Activity Feed for feed filters and custom-list feeds, and Profile Social for follower counts, banner actions and people in common. Turning off Social Activity no longer removes the feed filters.
- Removed the Web Components and Virtual Scrolling switches, which did nothing.

### Activity feeds

- Custom-list feeds now format text inside centered blocks (`~~~`): headings, bold, links and line breaks no longer show as raw markup.
- Bare links to anime, manga, characters, staff and studios show the name instead of the URL.
- The + button no longer appears on activity feed cards. The pencil stays.

### Notifications

- Reply notifications show the reply itself instead of the first post of the thread, without markdown symbols.
- Notifications from the same person about the same activity become one row with a note, such as "also liked your activity". Replies with different text stay separate.
- Grouped notifications no longer move AniList's own rows.

### Astra

- The report in AniList notes could stay outdated after a save that also changed progress, showing an old breakdown and losing General thoughts. It is now written. Notes already out of date update the next time the entry is saved; text lost earlier cannot be recovered.
- Setting Completed in Quick Edit fills an empty finish date with today.
- Raising the progress of a title not on your list, or of one on Planning from zero, sets it to Watching or Reading and fills an empty start date with today. Lowering it back undoes this.
- Closing Quick Edit reloads the page once AniList has received a status change, as deleting an entry does.
- Delete entry also appears for a title saved only in Astra. It now empties Astra and then AniList, and succeeds only if both are removed. If AniList fails, the Astra data comes back and nothing is queued for later. It no longer waits behind other page requests.
- Opening an entry with no local data now reads the scores and General thoughts from the report in AniList notes.

### Following

- Scores in Following rows always sit at the right edge, and the comment icon no longer covers them, on every page.
- Following rows show the chapter on manga pages, as they show the episode on anime pages.
- Following groups include members beyond the 50 most recent followings and members AniList has not loaded yet.

## 1.1.0

AniList Ultimate is no longer a beta: the extension name and description drop the beta label.

### People in common

- On another user's profile, a line under the name shows how many people you follow also follow them, how many they follow, and how many of those are in your custom user lists. Clicking a number lists them, with a search box for long lists.
- The profile's Social tab shows counts for Mutual Followers, Forum Threads, Forum Comments and Messages. Messages counts only what the profile sent on other people's profiles, as AniList's own tab does.

### Activity feeds

- Custom-list feeds look and behave like AniList's own feed. Text posts keep their formatting, spoilers, images and YouTube videos, and links open without reloading the page.
- Likes in custom feeds work. Without the extension login, a message explains how to connect.
- Filters work on custom lists. On a custom list, or on Following with the extension login, a filter fetches matching activity from AniList, so a filter such as Dropped no longer leaves the feed empty. Load More continues the same results.
- The selected custom list is remembered across reloads and no longer empties or stays loading after moving between pages. Custom feeds load faster.
- Score badges sit right after the title, and only on activities about a single title.

### Astra

- Saving from the Astra editor no longer reloads the page, and Quick Edit no longer waits on "Loading entry…".
- A Revert changes button undoes every change made since the editor was opened.
- The title in the editor follows the Open in New Tab setting.

### Calendar

- Add to Calendar shows airing titles from Search AniList with guidance instead of hiding them, and keeps your search text when switching between your lists and Search AniList.
- A button next to + and settings moves the calendar between the side column and full width.

### Custom User Lists settings

- The AU - Custom Lists link matches AniList's settings menu again.
- Hovering a member's avatar shows that clicking it opens their profile.
- Help messages adapt to the page you are on, and Retry appears only when it can help.

### Notifications

- Titles in notifications follow your AniList title language.

### Fixes

- The home page no longer keeps the processor busy in the background.

## 1.0.4

### Firefox

- Native Firefox version (Firefox 140 or later), built from the same source as the Chrome version with `npm run build:firefox`.
- Firefox uses its own AniList login client and redirect; the Chrome login is unchanged.
- Fixed Firefox-only issues: content scripts not loading, background start-up, extension pages rejected by the message router, Font Awesome icon errors and a purple box under the Astra navbar link.

### Calendar

- The weekly schedule is kept for the browser session, so reloading AniList shows the calendar without waiting for a new collection read. It is bound to the signed-in account and invalidated by pending or completed edits.
- The first calendar load uses a priority lane in the shared AniList request queue.

### Notifications

- Comment likes from the same person stay in one group.
- Grouped time ranges read "54 minutes – 1 hour ago" and no longer overlap the notification text.

### Build

- `npm run release` builds and packages both store archives and lints the Firefox package.

## 1.0.3

### Quick Edit

- Quick Edit asks once whether to score by sections or with a single score; the choice can be changed anytime in the Astra settings under Scoring Mode, and it is remembered for every entry.
- The Quick Edit window now sizes to its content: a single score or a few sections no longer leave empty space, and the radar only takes room when it is drawn.

### Security

- Update Vitest, its UI and V8 coverage provider to 4.1.12, including the patched mocker tooling for [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) and [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp).
- Update undici (used by jsdom in tests) to 7.30.1 for [GHSA-4qv8-2p9j-2685](https://github.com/advisories/GHSA-4qv8-2p9j-2685), [GHSA-f72v-6w45-q472](https://github.com/advisories/GHSA-f72v-6w45-q472) and [GHSA-xjj6-f33q-929c](https://github.com/advisories/GHSA-xjj6-f33q-929c).
- Fix the test UI command to use Vitest's supported API host option while keeping the server bound to localhost.

## 1.0.2

- Added custom Following groups on title pages and a navbar unread badge for Friend Alerts.
- Made Astra sync, scoring, notes and Quick Edit more reliable and easier to use.
- Improved Following progress updates, including automatic completion at the episode total.
- Kept background sync working across service worker restarts and unpacked rebuilds.

## 1.0.1

Beta listing package metadata for the Chrome Web Store.

## 1.0.0

Initial public source distribution of AniList Ultimate.

- Weekly airing calendar and progress controls.
- Configurable Astra scoring, season ratings, Journal and JSON backups.
- Yearly/custom-period Astra Wrapped and Seasonal Wrapped, with PNG exports.
- Friend Alerts, activity filters, notification grouping and social tools.
- Bulk editing of status and custom-list membership on each user's own lists.
- Public media metadata, theme links, review and forum enhancements.

Installation, account login and data handling are described in the [documentation](docs/README.md).
