# Anilist Ultimate v2 - Module Documentation

## Table of Contents

- [1. Calendar Module](#1-calendar-module)
- [2. Notification Cleaner Module](#2-notification-cleaner-module)
- [3. Activity Enhancer Module](#3-activity-enhancer-module)
- [4. Activity Score Module](#4-activity-score-module)
- [5. Astra Module (Advanced Scoring)](#5-astra-module-advanced-scoring)
- [6. Hover Comments Module](#6-hover-comments-module)
- [7. Social Activity Module](#7-social-activity-module)
- [8. Social Enhancer Module](#8-social-enhancer-module)
- [9. Custom List Module](#9-custom-list-module)
- [10. Media Social Enhancer Module](#10-media-social-enhancer-module)
- [11. Review Enhancer Module](#11-review-enhancer-module)
- [12. Forum Enhancer Module](#12-forum-enhancer-module)

---

## 1. Calendar Module

**Files:** `src/modules/calendar/`
**Feature Flag:** `calendar`
**Page Match:** `/` or `/home`
**CSS:** `calendar.css`, `settings-panel.css`

### Overview

Replaces AniList's native "Airing" section on the home page with a full weekly schedule calendar. Shows upcoming anime episodes grouped by day of the week.

### Components

| File | Class | Responsibility |
|------|-------|---------------|
| `CalendarModule.ts` | `CalendarModule` | Orchestrator - coordinates all calendar services |
| `CalendarService.ts` | `CalendarService` | Data fetching and transformation |
| `CalendarStore.ts` | `CalendarStore` | Reactive state management (Store<T>) |
| `CalendarDataService.ts` | `CalendarDataService` | Schedule data processing |
| `CalendarDomService.ts` | `CalendarDomService` | DOM manipulation and injection |
| `CalendarSocialService.ts` | `CalendarSocialService` | Friend activity overlays on cards |
| `AnimeCard.ts` | `AnimeCard` | Individual anime card component |
| `CalendarGrid.ts` | `CalendarGrid` | Weekly grid layout |
| `CalendarSkeleton.ts` | `CalendarSkeleton` | Loading state skeleton UI |
| `DayColumn.ts` | `DayColumn` | Single day column in the grid |
| `SettingsPanel.ts` | `SettingsPanel` | Calendar settings modal |

### Features

- **Weekly Schedule View** - 7-day grid with anime cards
- **3 Layout Modes** - Standard, Compact, Extended
- **Real-time Countdown** - Updates every 60 seconds
- **Mark Watched** - Increment progress via API mutation
- **Social Avatars** - Friend activity on each card (when socialEnabled)
- **Settings Panel** - Start day, layout, time format, alignment, etc.
- **Responsive Design** - Adapts to mobile/tablet
- **Smart Caching** - 30-minute schedule cache, 5-minute progress cache

### Configuration

```typescript
interface CalendarPreferences {
  startDay: string;           // '0'-'6' (Sunday-Saturday)
  hideEmptyDays: boolean;
  layoutMode: 'standard' | 'compact' | 'extended';
  timeFormat: 'release' | 'countdown';
  showTime: boolean;
  showEpisodeNumbers: boolean;
  titleAlignment: 'left' | 'center' | 'right';
  columnJustify: 'top' | 'center' | 'bottom';
  maxCardsPerDay: number;     // 0 = unlimited
  fullWidthImages: boolean;
  openInNewTab: boolean;
  socialEnabled: boolean;
  socialShowAvatars: boolean;
}
```

### API Queries

- `AiringSchedule` - Fetch weekly airing schedule
- `MediaListCollection` - Fetch user's watching list for progress
- `SaveMediaListEntry` - Mutation to increment episode progress
- `Page.mediaList` (batched aliases) - Friend activity per media

---

## 2. Notification Cleaner Module

**Files:** `src/modules/notifications/`
**Feature Flag:** `notificationCleaner`
**Page Match:** `/notifications`
**CSS:** `notification-cleaner.css`

### Overview

Groups consecutive notifications from the same user, adds a search bar, and enhances notification cards with activity context.

### Components

| File | Class | Responsibility |
|------|-------|---------------|
| `NotificationCleanerModule.ts` | `NotificationCleanerModule` | Orchestrator |
| `NotificationFetchService.ts` | `NotificationFetchService` | Batch fetching activity details via GraphQL |
| `NotificationGroupService.ts` | `NotificationGroupService` | Grouping logic, text generation, DOM manipulation |
| `NotificationFilterService.ts` | `NotificationFilterService` | Search/filter UI and logic |

### Features

- **Consecutive Grouping** - Merges consecutive notifications from the same user
- **Virtual Notifications** - Creates summary cards ("liked 5 of your activities")
- **Dropdown Expand** - Click virtual card to see individual notifications
- **Activity Context** - Shows what media/text was liked/replied to
- **Timestamp Range** - Displays `[Recent] - [Oldest]` for grouped notifications
- **Search Bar** - Filter notifications by user, content, or media
- **Merge/Unmerge Toggle** - User can disable grouping

### Grouping Algorithm

```
For each notification (in DOM order):
  1. Extract username from <a href="/user/...">
  2. Detect notification type (activity_like, message, reply, etc.)
  3. If previous visible notification is same user:
     a. If virtual card already exists -> add to it
     b. Else if in current group -> add to group
     c. Else -> start new group with prev + current
  4. Else: close current group, start new single group

For each group with count > 1:
  -> Create virtual notification card
  -> Create dropdown with cloned sub-notifications
  -> Hide original notifications
  -> Enhance with activity details (batch GraphQL)
```

### Notification Types Detected

| Type | Text Pattern |
|------|-------------|
| `activity_like` | "liked your activity" |
| `message` | "sent you a message" |
| `thread_like` | "liked your forum thread" |
| `reply_like` | "liked your activity reply" |
| `activity_reply` | "replied to your activity" |
| `follow` | "followed you" |
| `mention` | "mentioned you" |

---

## 3. Activity Enhancer Module

**Files:** `src/modules/activity/`
**Feature Flag:** `socialActivity`
**Page Match:** `/` or `/home`
**CSS:** `activity-enhancer.css`

### Overview

Enhances the activity feed on the home page with filtering, search, and custom list integration.

### Components

| File | Class | Responsibility |
|------|-------|---------------|
| `ActivityEnhancerModule.ts` | `ActivityEnhancerModule` | Orchestrator |
| `ActivityService.ts` | `ActivityService` | Batched score fetching for activity entries |
| `ActivityFilterBar.ts` | `ActivityFilterBar` | Reusable filter UI component |
| `ActivityRenderer.ts` | `ActivityRenderer` | Activity card rendering and visibility |
| `CustomListTabManager.ts` | `CustomListTabManager` | Custom list tab in feed type toggle |
| `ActivityUtils.ts` | - | Type definitions and utility functions |

### Features

- **Activity Filtering** - Filter by type: All, Watched, Read, Completed, Paused, Dropped, Plans, Text posts
- **Search** - Full-text search across activity entries
- **Custom List Activities** - View activities from users in custom friend lists
- **Shared Components** - FilterBar and Renderer are reusable across modules

### Filter Types

```typescript
type ActivityType = 'all' | 'watched' | 'read' | 'completed' | 'paused'
                  | 'dropped' | 'plans' | 'text' | 'anime' | 'manga';
```

---

## 4. Activity Score Module

**Files:** `src/modules/activity/ActivityScoreModule.ts`
**Feature Flag:** `activityScore`
**CSS:** `activity-score.css`

### Overview

Displays user scores on activity feed entries. When a user updates their anime/manga progress, this module fetches and shows their score alongside.

### Data Flow

1. MutationObserver detects new activity entries in the feed
2. Extract username and mediaId from each entry
3. Batch fetch scores via `ActivityService.getScoresBatch()`
4. Inject score badges into activity cards

### API Query (Alias Batching)

```graphql
query {
  s0: MediaList(userName: "user1", mediaId: 123) {
    score(format: POINT_100)
    user { mediaListOptions { scoreFormat } }
  }
  s1: MediaList(userName: "user2", mediaId: 456) { ... }
}
```

---

## 5. Astra Module (Advanced Scoring)

**Files:** `src/modules/astra/`
**Feature Flag:** Always enabled (`enabled: true`)
**Page Match:** `/`, `/home`, `/user/*/`, `/user/*/animelist`, `/user/*/astra`
**CSS:** `astra.css`

### Overview

Advanced multi-criteria scoring system. Users can rate anime/manga across multiple weighted categories (Story, Characters, Visuals, Audio, Enjoyment, Finale, Originality, Consistency). Includes season-level tracking and series averages.

### Components

| File | Class | Responsibility |
|------|-------|---------------|
| `AstraModule.ts` | `AstraModule` | Orchestrator, card pill injection, progress enhancement |
| `AstraService.ts` | `AstraService` | Data management, score calculations, AniList sync |
| `AstraDashboard.ts` | `AstraDashboard` | Full dashboard UI for `/user/*/astra` page |
| `AstraRadarChart.ts` | `AstraRadarChart` | SVG radar chart for score visualization |
| `AstraRatingModal.ts` | `AstraRatingModal` | Quick-rate modal from card pills |

### Features

- **Multi-Criteria Scoring** - 9 default scoring categories with customizable weights
- **Sub-Sections** - Each category can have weighted sub-sections
- **Season Tracking** - Rate each season separately
- **Series Finale Bonus** - Double weight for finale category when marked
- **Skip Categories** - Per-season ability to skip irrelevant categories
- **AniList Sync** - Import entire anime/manga list from AniList
- **Export/Import** - JSON export and import for backup
- **Card Pills** - Action buttons injected on anime cards (Mark Watched, Quick Rate, Social)
- **Dashboard Tab** - Custom `/user/*/astra` page with full management UI
- **Radar Chart** - Visual representation of scores per section
- **Episode Notes** - Per-episode notes with optional scores

### Default Scoring Sections

| Section | Default Weight |
|---------|---------------|
| Story | 3 |
| Characters | 3 |
| Visuals | 2 |
| Audio | 1 |
| Enjoyment | 3 |
| Finale | 2 (x2 if series finale) |
| Bullshit | 1 |
| Originality | 2 |
| Consistency | 2 |

### Score Calculation

```
Section Score = weighted average of sub-sections (if any), or direct score
Season Overall = weighted average of all non-skipped section scores
Series Overall = simple average of all season overall scores
```

### Storage

Data stored in `chrome.storage.local` under key `au_astra_data`:
```json
{
  "works": [...],
  "sections": [...],
  "settings": { "enableSeriesFinale": true },
  "lastUpdated": 1234567890
}
```

---

## 6. Hover Comments Module

**Files:** `src/modules/social/HoverCommentsModule.ts`, `CommentTooltip.ts`
**Feature Flag:** `hoverComments`
**CSS:** `hover-comments.css`

### Overview

On anime/manga pages, fetches user notes from the "Following" section and displays them as hoverable tooltips.

### Features

- **Note Detection** - Scans the "Following" sidebar for users with notes
- **Batch Fetching** - Uses GraphQL alias batching for all users at once
- **Tooltip Display** - Hover over comment icon to see user's notes
- **Polling** - Re-checks every 3 seconds for dynamically loaded content
- **Cache** - Notes cached in memory to avoid re-fetching
- **Fallback** - If batch fails, falls back to sequential fetching

### API Query (Alias Batching)

```graphql
query {
  user_0: MediaList(userName: "user1", mediaId: 123) { notes }
  user_1: MediaList(userName: "user2", mediaId: 123) { notes }
}
```

---

## 7. Social Activity Module

**Files:** `src/modules/social/SocialActivityModule.ts`
**Feature Flag:** `friendActivity`
**CSS:** `social-activity.css`

### Overview

Provides social activity sidebar and friend avatars on calendar cards.

### Features

- **Social Sidebar** - Expandable panel showing who among your friends is watching/reading
- **Avatar Overlays** - Friend avatars on calendar anime cards
- **Status Filters** - Filter by status (Watching, Completed, etc.)

---

## 8. Social Enhancer Module

**Files:** `src/modules/social/SocialEnhancerModule.ts`
**Feature Flag:** `friendActivity`

### Overview

Enhances social features across the site, including avatar pills on media cards and best friend indicators.

---

## 9. Custom List Module

**Files:** `src/modules/social/CustomListModule.ts`, `CustomListService.ts`
**Feature Flag:** `friendActivity`
**CSS:** `custom-lists.css`

### Overview

Allows users to create custom friend lists for filtering activities.

### Components

| File | Class | Responsibility |
|------|-------|---------------|
| `CustomListModule.ts` | `CustomListModule` | Module orchestrator |
| `CustomListService.ts` | `CustomListService` | List CRUD operations, storage |
| `CustomListManager.ts` | `CustomListManager` | UI component for list management |

### Features

- **Create/Edit/Delete Lists** - Named groups of followed users
- **Activity Filtering** - View activities from a specific list only
- **Persistent Storage** - Lists saved to Chrome sync storage
- **Integration** - Activity Enhancer adds custom list tab to feed toggle

---

## 10. Media Social Enhancer Module

**Files:** `src/modules/social/MediaSocialEnhancer.ts`
**Feature Flag:** `friendActivity`

### Overview

Enhances individual anime/manga pages with social activity information and filtering.

### Features

- **Social Activity Feed** - Shows friend activity on media pages
- **Filter Bar** - Reuses `ActivityFilterBar` shared component
- **Custom List Integration** - Filter by custom friend lists on media pages

---

## 11. Review Enhancer Module

**Files:** `src/modules/reviews/`
**Feature Flag:** `reviewEnhancer`
**CSS:** `review-enhancer.css`

### Components

| File | Class | Responsibility |
|------|-------|---------------|
| `ReviewEnhancerModule.ts` | `ReviewEnhancerModule` | Module orchestrator |
| `ReviewService.ts` | `ReviewService` | Review data fetching and caching |

### Features

- **Score Display** - Shows review scores on review cards
- **Score Formatting** - Adapts to user's preferred score format

---

## 12. Forum Enhancer Module

**Files:** `src/modules/forum/ForumEnhancerModule.ts`
**Feature Flag:** `forumEnhancer`
**CSS:** `forum-enhancer.css`

### Overview

Enhances forum threads with additional UI features and quality-of-life improvements.

---

## Shared Services

### SocialService

**File:** `src/modules/social/SocialService.ts`

Handles batched friend activity fetching and paginated detailed activity queries.

**Key Methods:**
- `getFriendActivityBatch(mediaIds)` - Batch fetch friend activity for multiple media
- `getDetailedActivity(mediaId, filter, page, status)` - Paginated detailed activity
- `getAllFollowings()` - Fetch all users the current viewer follows

**Caching:** Daily cache invalidation (`cacheDate` compared to today's date).

### BestFriendService

**File:** `src/modules/social/BestFriendService.ts`

Manages a "best friends" list for priority display in social features.

### CommentService

**File:** `src/modules/social/CommentService.ts`

Handles comment fetching and display for social features.

### SocialRenderer

**File:** `src/modules/social/SocialRenderer.ts`

Renders social UI elements (avatars, status badges, score displays).
