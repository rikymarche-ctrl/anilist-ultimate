# Anilist Ultimate v2

**The definitive Chrome extension for power users of [AniList](https://anilist.co).** Modular, TypeScript-first architecture delivering calendar views, social features, advanced scoring, notification grouping, and more.

| | |
|---|---|
| **Version** | 2.0.0 |
| **License** | GPL-3.0 |
| **Platform** | Chrome / Edge / Brave (Manifest V3) |
| **Language** | TypeScript 5.4+ |
| **Build** | Vite 5.2 + @crxjs/vite-plugin |

---

## Features

### Airing Calendar
Replaces the native "Airing" section with a full weekly schedule. Three layout modes (Standard, Compact, Extended), real-time countdown, mark-watched buttons, and friend activity overlays.

### Astra - Advanced Scoring
Multi-criteria rating system with 9 weighted categories (Story, Characters, Visuals, Audio, Enjoyment, Finale, Originality, Consistency, Bullshit). Season-level tracking, radar charts, and full AniList list sync.

### Notification Cleaner
Groups consecutive notifications from the same user, adds search/filter, and enriches cards with activity context (media titles, reply previews). Toggle merge/unmerge on demand.

### Activity Enhancer
Filter bar for the activity feed (Watched, Read, Completed, Dropped, Plans, Text). Full-text search. Custom friend list integration for scoped activity views.

### Social Features
Friend activity overlays on anime cards, social sidebar on media pages, custom friend lists, best-friend indicators, and avatar pills on the calendar.

### Hover Comments
On anime/manga pages, fetches notes from users in the "Following" section and shows them as hoverable tooltips.

### Review Enhancer
Displays review scores directly on review cards across the site.

### Forum Enhancer
Quality-of-life improvements for AniList forum threads.

---

## Architecture

```
src/
  core/        Framework: DI container, EventBus, ConfigManager, Navigation,
               Storage, State Store, Error Handling, Auth, Logging
  api/         GraphQL client with rate limiting and request queuing
  modules/     12 feature modules, each extending BaseModule
  ui/          Shared UI components (Toast, BaseComponent)
  styles/      Per-module CSS stylesheets
```

**Key patterns:**
- Dependency Injection via [tsyringe](https://github.com/microsoft/tsyringe)
- Event-driven communication (pub/sub EventBus)
- SPA-aware navigation (history interception + MutationObserver)
- Feature flags via ConfigManager (all modules toggleable)
- GraphQL alias batching for efficient API usage

Full architecture documentation: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+
- Chrome, Edge, or Brave browser

### Installation

```bash
git clone https://github.com/rikymarche-ctrl/anilist-ultimate.git
cd anilist-ultimate/anilist-ultimate-v2
npm install
```

### Development

```bash
npm run dev          # Start Vite dev server with HMR
npm run build        # Production build to dist/
npm test             # Run Vitest test suite
npm run lint         # ESLint check
npm run format       # Prettier formatting
```

### Loading in Browser

1. Run `npm run build`
2. Open `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `dist/` folder

### Authentication

The extension uses AniList OAuth (implicit grant). On first use:
1. Navigate to `https://anilist.co`
2. The extension will prompt you to authenticate
3. Authorize via AniList's OAuth page
4. Token is saved automatically

---

## Project Structure

```
anilist-ultimate-v2/
  public/
    manifest.json              Manifest V3 configuration
    icons/                     Extension icons
  src/
    main.ts                    Entry point
    setup.ts                   DI container configuration
    core/
      auth/                    OAuth token service
      config/                  Configuration manager + types + defaults
      di/                      DI container, tokens, types
      errors/                  Error handler + custom error types
      events/                  EventBus + event type definitions
      interfaces/              Service contracts (IApiClient, IModule, etc.)
      modules/                 BaseModule, ModuleRegistry, ModuleLoader
      navigation/              SPA navigation service
      services/                ToastService
      state/                   Reactive Store<T>
      storage/                 Chrome storage wrapper
      utils/                   ScoreFormatter, Template
      constants.ts             Global constants
      logger.ts                Logging utility
      ThemeManager.ts          Theme detection
      types.ts                 Shared types
    api/
      AnilistClient.ts         GraphQL client with rate limiting
      AnilistTypes.ts          API response types
      queries/                 Query definitions
    modules/
      activity/                Activity feed enhancement
      astra/                   Advanced scoring system
      calendar/                Airing schedule calendar
      forum/                   Forum enhancements
      notifications/           Notification grouping
      reviews/                 Review score display
      social/                  Social features suite
    ui/
      components/              BaseComponent, Toast, ToastContainer
    styles/                    Per-module CSS files
  docs/
    ARCHITECTURE.md            System architecture documentation
    MODULES.md                 Per-module feature documentation
    SECURITY.md                Security audit report
    BUGS.md                    Known issues and bug report
  vite.config.ts               Vite + CRXJS configuration
  tsconfig.json                TypeScript configuration
  package.json                 Dependencies and scripts
```

---

## Configuration

All features are toggleable via the `ConfigManager`. Default configuration:

| Feature | Default | Description |
|---------|---------|-------------|
| `calendar` | Enabled | Weekly airing schedule |
| `hoverComments` | Enabled | Note tooltips on media pages |
| `notificationCleaner` | Enabled | Notification grouping |
| `reviewEnhancer` | Enabled | Review scores on cards |
| `friendActivity` | Enabled | Social features suite |
| `socialActivity` | Enabled | Social activity feed |
| `forumEnhancer` | Enabled | Forum improvements |
| `activityScore` | Enabled | Scores in activity feed |
| `listEditor` | Disabled | List editor (WIP) |

Configuration is persisted to `chrome.storage.sync` and syncs across devices.

---

## API Usage

The extension communicates with the AniList GraphQL API (`https://graphql.anilist.co`).

**Rate limiting:**
- Max 90 requests/minute
- 700ms delay between requests
- Max 2 concurrent requests
- Exponential backoff on failure (1s, 2s, 4s)
- 60-second cooldown on HTTP 429

**Optimizations:**
- GraphQL alias batching (multiple resources per request)
- In-memory caching (daily for social, 30min for schedule)
- Request queuing and prioritization

---

## Testing

```bash
npm test                  # Run all tests
npm run test:ui           # Vitest UI
```

**Framework:** Vitest + jsdom
**Coverage:** Configured (`text`, `json`, `html` reporters)
**Manual testing guide:** [`docs/TESTING.md`](docs/TESTING.md)

---

## Documentation

📖 **[Complete Documentation Index →](docs/README.md)**

### Quick Links

| Document | Description |
|----------|-------------|
| **Technical** | |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture, design patterns, DI structure |
| [`docs/MODULES.md`](docs/MODULES.md) | Detailed breakdown of all 12 modules |
| **Issue Tracking** | |
| [`docs/BUGS.md`](docs/BUGS.md) | Known bugs (38 total) with severity & fixes |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Security audit (18 findings, 4 critical) |
| [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) | Performance issues (7 problems) |
| **Development** | |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Feature roadmap (14 items, 43h effort) |
| [`docs/TODO.md`](docs/TODO.md) | Current work & ideas |
| [`docs/TESTING.md`](docs/TESTING.md) | Manual testing procedures |
| **Release** | |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history & release notes |

**Current Status:**
- ✅ P0 Critical Bugs: **FIXED** (dual token, Store.reset, XSS, GraphQL injection x2)
- ⚠️ P1 Open Issues: 4 (cache corruption, memory leak, API spam, GraphQL injection in SocialService)
- 📊 Total tracked issues: 38 bugs + 18 security + 7 performance = **63 items**

---

## Build

### Production Build

```bash
npm run build
```

**Output:** `dist/` folder ready for Chrome Web Store or manual loading.

**Optimizations:**
- Terser minification (2-pass compression)
- Console stripping (`console.log`, `console.debug`, `console.info`)
- Code splitting (vendor chunk for tsyringe + reflect-metadata)
- Comment removal
- Compressed size reporting

### Bundle Analysis

| Component | Size | Gzipped |
|-----------|------|---------|
| Calendar Module | ~90 KB | ~24 KB |
| Main Logic | ~8 KB | ~3 KB |
| Styles | ~19 KB | ~2 KB |
| Icons | ~85 KB | - |
| **Total** | **~205 KB** | **~32 KB** |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Write code following existing patterns (DI, BaseModule, EventBus)
4. Add tests for new functionality
5. Run `npm run lint` and `npm run format`
6. Submit a Pull Request

### Code Style

- **TypeScript strict mode** enabled
- **ESLint + Prettier** for formatting
- **Path aliases** (`@core/`, `@modules/`, `@ui/`)
- **Decorators** for DI (`@injectable()`, `@inject()`, `@singleton()`)
- **BaseModule** for all feature modules

---

## License

[GPL-3.0](LICENSE)

---

## Author

**ExAstra** - Architecture, implementation, and design.
