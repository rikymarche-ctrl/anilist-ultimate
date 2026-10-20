# Astra Wrapped

Open **Astra → Wrapped → Astra Wrapped**.

## Use

Choose this year, this month or custom inclusive start/end dates through the period control. Use custom dates for a previous year. **Update recap** loads the selected period; **Include private and hidden titles** starts unchecked. Provider results can be reused from a short-lived account/session/period cache, so updating does not guarantee an immediate remote refetch.

The story includes watching/reading totals, rhythm, top titles, genres, themes, format/country/source mix, eras, studios/creators, voice actors, community comparisons and social activity where the necessary data exists. Slides depend on the available sample. Arrows, progress segments and keyboard navigation control the story; interactive slides pause autoplay and reduced-motion preferences disable it.

**Download PNG** creates a local share card. It does not upload or post it. Check the exported content before sharing, especially when including private titles.

## Data sources

- AniList list activities in the selected period, plus earlier progress needed for completion baselines.
- Current AniList media details and list entries: lengths, durations, scores, privacy, genres, studios, staff and characters.
- AniList posts, received-message metadata and engagement counts, plus all-time anime genre statistics for comparison.
- The current local Astra archive supplies series score overrides and private/hidden flags. Journal text is not a substitute activity timeline.

The loader is `src/modules/astra/services/year/YearReviewService.ts`; provider validation and pure calculations are separated in `YearReviewResponse.ts` and `YearReview.ts`. The view is `src/modules/astra/ui/AstraWrappedView.ts`.

## Counting rules and limits

| Value                    | Interpretation                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Progress                 | A logged range such as 4–10 counts seven units on the activity's logged date.                                          |
| Completion               | Adds the known total minus last known progress, using an earlier-period baseline when needed.                          |
| Rewatch/reread           | Uses the available repeat activity; it is not a full reconstruction of every prior cycle.                              |
| Time watched             | Episode counts multiplied by available episode duration; no reading-hours estimate.                                    |
| Days and hours           | Local browser dates/times of logged activity, not measured playback sessions.                                          |
| Scores                   | Current Astra series score when available, otherwise the current AniList score; not the score as it stood at the time. |
| Community/staff rankings | Derived from available metadata and the period's participating titles; incomplete metadata can affect rankings.        |

Missing or deleted activities, merged progress, private data unavailable to the provider and unknown lengths/durations limit the result. A single large update is not evidence that every episode was watched that day.

The loader caps list-activity pagination at 100 pages of 50 entries (5,000 updates), with truncation tracked in the report. Social loading has a separate 20-page cap. Popularity, community scores, people and all-time genres are present-day metadata, not frozen historical snapshots.

The privacy switch filters known private/hidden title contributions to the displayed recap; it does not prevent authenticated data loading and does not anonymize community names or aggregate social figures. Inspect the share card itself.

## Storage, privacy and failure

The service caches up to four period results for 30 minutes, keyed by account/session and dates. Astra overrides are reread on each load. Closing or changing the account retires the view's results and exports rather than publishing old responses into the new context.

Opening a recap performs read requests and local image rendering. It does not change AniList entries or publish a story. Errors offer a retry; no available activity is shown as an empty state rather than invented history.
