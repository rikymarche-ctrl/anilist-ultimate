# Module map

Feature areas and source locations.

| Area          | Source directory                                     | Behavior and boundaries                                                                                              |
| ------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Calendar      | `src/modules/calendar/`                              | Airing schedule, card rendering, layout preferences and progress controls; account data uses background API clients. |
| Astra         | `src/modules/astra/`                                 | Dashboard, section-based ratings, season data, Journal, validated local persistence, backup and sync integration.    |
| Wrapped       | `src/modules/astra/services/year/` and `ui/wrapped/` | Yearly provider-driven reports and stories; seasonal model/services live beside the year services.                   |
| Activity      | `src/modules/activity/`                              | Feed filters, rendered context and activity score enrichment.                                                        |
| Notifications | `src/modules/notifications/`                         | Grouping/enrichment of native notifications and the independent local Friend Alerts feature.                         |
| Social        | `src/modules/social/`                                | Custom audiences, Following progress, Following groups (Social tab and title Overview, local), note tooltips, profile and media social panels. |
| Bulk Editor   | `src/modules/bulk/`                                  | Sequential status/custom-list edits on the authenticated user's own anime/manga lists.                               |
| Media         | `src/modules/media/`                                 | Public metadata and theme lists; external links are distinct from account writes.                                    |
| Reviews       | `src/modules/reviews/`                               | Review score enrichment.                                                                                             |
| Forum         | `src/modules/forum/`                                 | Forum interface enhancements.                                                                                        |
| Restore       | `src/modules/restore/`                               | Page-state capture and restoration across supported navigation.                                                      |

## Settings and activation

Current source feature keys include `calendar`, `astra`, `friendAlerts`, `notificationCleaner`, `hoverComments`, `friendActivity`, `socialActivity`, `listEditor`, `activityScore`, `reviewEnhancer`, `forumEnhancer`, `mediaMetadata`, `mediaMusic` and `pageRestore`. Supporting flags also exist. Refer to `src/core/config/defaults.ts` and the settings UI for actual defaults and grouping rather than assuming one switch per file.

Login, supported page type and account ownership can further gate a feature. The Bulk Editor checks the route owner against the viewer before activating selection; it verifies IDs/session again when loading and saving. No username is the privileged public editing account.

## Important entry points

- Registration/order: `src/setup.ts`.
- Site bootstrap: `src/main.ts`; worker bootstrap and alarms: `src/background.ts`.
- Shared runtime messages: `src/shared/`; API transport/proxy: `src/api/`.
- Foreground lifecycle: `src/core/modules/`, `src/core/navigation/` and `src/core/observers/`.
- Shared rendering and icons: `src/core/utils/` and `src/core/ui/`.
- User-facing settings: `src/settings/` and feature-specific settings views.

## Detailed feature contracts

[User guide](USER_GUIDE.md), [Astra Wrapped](ASTRA_WRAPPED.md), [Seasonal Wrapped](SEASONAL_WRAPPED.md), [Friend Alerts](FRIEND_ALERTS.md), [Bulk Editor](BULK_EDITOR.md), [Notes safety](ASTRA_NOTES_SAFETY.md).

For persistence/ownership boundaries, use [architecture](ARCHITECTURE.md).
