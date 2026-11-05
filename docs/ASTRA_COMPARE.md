# Astra Compare

A long, Wrapped-style comparison between your list and another user's, for anime and for manga.

## Where it is

On another user's anime or manga list page, under AniList's **Compare with your list**. AniList only shows its own button to signed-in viewers; if it is missing, **Astra compare** sits at the end of the same filter column. It never appears on your own lists or when your account is not connected to the extension.

The switch is **Astra Compare** in the extension settings (`astraCompare`, on by default).

## What it shows

Slides without honest data are left out, so the length depends on the two lists.

| Slide | Content |
| --- | --- |
| Head to head | Titles, hours or chapters, mean score, spread, completed, dropped, drop rate, planning, rewatches |
| Shared titles | Overlap as a share of each list, with a circle chart sized by the real counts |
| Score affinity | Pearson correlation of the scores of titles both rated, from five titles up |
| Scoring habits | How each person uses the 1-10 scale, and a plot of every title both rated |
| You rate higher / They rate higher | Largest score gaps on each side, on a shared 0-10 ruler |
| Loved by both / Disliked by both | Titles where both scores agree |
| Finished against dropped | One completed it, the other gave up |
| Rarest links | Shared titles with the fewest AniList users |
| Genres / Scores by genre | Share of each list, and where the averages differ most |
| Themes | AniList tags, without adult or spoiler tags |
| Formats and decades | Formats, release decades, countries |
| People in common | Studios, voice actors and staff on both top-fifty lists (authors and staff for manga) |
| Who was first | Count per person, then the longest head starts with both real dates |
| Homework | High scores from one list that the other has not seen |
| All titles | Every title, searchable and sortable: both, only you, only them |
| Verdict | Summary and a 1080 × 1920 PNG card |

## Rules

- **Privacy:** your private entries never count. A title you hid is still not recommended back to you. Adult titles count in totals but are never named or pictured, and the Hentai genre is never printed.
- **Who was first:** start dates are compared when both exist, otherwise finish dates, and only full dates count.
- **Private lists:** AniList answers `Private User`. The story shows a message and your own list is not read.
- **Rate limit:** every request goes through the shared queue, which stays under AniList's limit. The other person's list stays cached for 10 minutes per account and media type; yours is read fresh at each opening, so a new score shows at once.

## Code

`src/modules/social/compare/`: `ProfileCompareModule` (button), `ProfileCompareService` and `ProfileCompareResponse` (data), `ProfileCompareModel` and `ProfileCompareExtras` (pure calculations), `ProfileCompareSlides`, `ProfileCompareDeepSlides` and `ProfileCompareBrowser` (story), `ProfileCompareImage` (PNG), `ProfileCompareView` (overlay). Styles are in `src/styles/profile-compare.css`, scoped under `.versus-wrapped` because the bundle order of the stylesheets is not guaranteed.
