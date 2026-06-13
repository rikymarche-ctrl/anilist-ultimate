# Anilist Ultimate - Changelog

## [Unreleased] - Code review hardening & test foundation (2026-06)

### 🔒 Security
- GraphQL injection fully closed: `GraphQLBatcher.format()` always quotes/escapes (no `$`-passthrough); `HoverCommentsModule` uses GraphQL variables.
- XSS fixed: `AstraRadarChart` escapes user-editable section names; `CustomListManager` search uses the auto-escaping `html` template.
- Removed dead/bypassable `Sanitizer.sanitize()`/`formatMultiline()` (kept `escape()`).

### 🐛 Fixes
- `AnilistClient.clearQueue()` now rejects pending promises (no hung callers).
- `background.ts` gates the message router on DI init (MV3 cold-start race).
- `AstraRepository.factoryReset()` scans storage correctly (was a no-op).
- `SyncQueueService` serializes the queue via an async mutex (read-modify-write race).
- `EventBus.emit()` isolates synchronous handler throws (no cascading failure).

### ⚡ Performance
- AniList sync no longer re-serializes the manifest per entry (`skipPersist` + single `persist()`): O(n²) → O(n).

### 🧹 Refactor / Cleanup
- Removed dead code (`CustomScrollbar`, `AstraStatsOverview`, `AstraWorkGrid`).
- De-duplicated Astra DI registration in `setup.ts`; `AstraSyncService` now injects `EventBus` (no service-locator).
- Defensive copies in `AstraRepository` getters; managed event listeners; `console.log` → `log.debug`.

### ✅ Testing
- New Vitest foundation: 15 files, 109 tests, `tsc` clean. See `docs/TESTING.md`.

## [2.0.0] - 2026-04-07

### 🎉 Complete Rewrite - Modern TypeScript Architecture

#### ✨ New Features

**Core Infrastructure**
- ✅ Modern TypeScript codebase with strict type checking
- ✅ Vite build system with hot module replacement
- ✅ Custom reactive state management (~180 lines, zero dependencies)
- ✅ Component-based architecture with BaseComponent class
- ✅ Chrome storage wrapper with type safety
- ✅ Structured logging system with levels

**Calendar Module**
- ✅ Weekly anime schedule calendar view
- ✅ Replace native Anilist "Airing" section
- ✅ 3 layout modes: Standard, Compact, Extended
- ✅ Group anime by day of the week
- ✅ Display cover images, titles, episodes, airing times
- ✅ Mark episodes as watched (✓ button)
- ✅ Real-time countdown updates (every 60s)
- ✅ Click cards to open anime page
- ✅ Responsive design (desktop → mobile)

**Settings System**
- ✅ Full-featured settings panel
- ✅ Layout customization (mode, alignment, justify)
- ✅ Display options (time, episodes, empty days)
- ✅ Week configuration (start day, max cards)
- ✅ Persistent preferences (Chrome sync storage)
- ✅ Reset to defaults option
- ✅ Real-time preview of changes

**API & Data**
- ✅ GraphQL client with rate limiting (90 req/min)
- ✅ Request queuing system
- ✅ OAuth authentication support
- ✅ Automatic retry on failures
- ✅ Error handling and user feedback

**UI/UX**
- ✅ Dark/Light theme support
- ✅ Smooth animations and transitions
- ✅ Loading states and error messages
- ✅ Auth prompt for non-logged users
- ✅ FontAwesome icons integration
- ✅ Mobile-responsive design

#### 🏗️ Architecture Improvements

**Before (v1)**
- ❌ 2005-line monolithic calendar.js
- ❌ Global namespace pollution (window.AnilistUltimate)
- ❌ No build system
- ❌ Manual DOM manipulation everywhere
- ❌ No state management
- ❌ Difficult to test

**After (v2)**
- ✅ Modular 12-file architecture
- ✅ TypeScript with 150+ type definitions
- ✅ Vite bundler with code splitting
- ✅ Component-based UI
- ✅ Reactive state store
- ✅ Unit test ready (Vitest configured)

#### 📦 Bundle Size

**Total:** ~205 KB (uncompressed), ~32 KB (gzipped)

| Component | Size | % of Total |
|-----------|------|------------|
| Calendar Module | 90 kB | 44% |
| Main Logic | 8 kB | 4% |
| Styles | 19 kB | 9% |
| Icons | 85 kB | 41% |

**Optimization:** -50% size vs v1 (estimated)

#### 🛠️ Technical Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| Language | TypeScript 5.4+ | Type safety |
| Build | Vite 5.2+ | Fast bundling |
| Extension | @crxjs/vite-plugin | Chrome extension support |
| State | Custom Store | Lightweight reactive state |
| API | graphql-request | GraphQL client |
| Testing | Vitest | Unit tests |
| Linting | ESLint + Prettier | Code quality |

#### 📁 Project Structure

```
src/
├── core/              # Core utilities (600 lines)
│   ├── types.ts       # Type definitions (300)
│   ├── constants.ts   # Global constants (150)
│   ├── logger.ts      # Logging system (80)
│   ├── state/         # State management (180)
│   └── storage/       # Storage API (200)
├── ui/                # UI system (250 lines)
│   └── components/    # Base components
├── api/               # API layer (400 lines)
│   ├── AnilistClient.ts  # GraphQL client (320)
│   └── queries/          # Query definitions (80)
├── modules/           # Feature modules
│   └── calendar/      # Calendar module (1,800 lines)
│       ├── CalendarModule.ts    # Orchestrator (380)
│       ├── CalendarService.ts   # Data service (200)
│       ├── CalendarStore.ts     # State (250)
│       └── components/          # UI components (970)
└── styles/            # Stylesheets (500 lines)

Total: ~3,550 lines of code
```

#### 🎯 Features Status

| Feature | v1 | v2 | Status |
|---------|----|----|--------|
| Weekly Calendar | ✅ | ✅ | Enhanced |
| Multiple Layouts | ✅ | ✅ | 3 modes |
| Mark Watched | ✅ | ✅ | Improved |
| Settings Panel | ⚠️ | ✅ | **NEW** |
| Type Safety | ❌ | ✅ | **NEW** |
| State Management | ❌ | ✅ | **NEW** |
| Hot Reload | ❌ | ✅ | **NEW** |
| Testing | ❌ | ⏳ | Ready |
| Hover Comments | ❌ | ⏳ | Planned |
| Friend Activity | ❌ | ⏳ | Planned |
| List Editor | ❌ | ⏳ | Planned |

#### 🚀 Performance

- **Build Time:** 1.54s (vs manual reload in v1)
- **Type Check:** <2s (instant feedback)
- **Hot Reload:** <1s (development)
- **Bundle Size:** -50% (optimized)

#### 🧪 Testing

**Setup:**
- ✅ Vitest configured
- ✅ Test structure ready
- ✅ Coverage reporting enabled
- ⏳ Tests to be written (Phase 3)

**Current Coverage:** 0% (no tests yet)
**Target Coverage:** >80%

#### 📝 Documentation

**Created:**
- ✅ README.md (comprehensive guide)
- ✅ TESTING.md (testing checklist)
- ✅ CHANGELOG.md (this file)
- ✅ Inline code comments
- ✅ Type definitions with JSDoc

#### 🔧 Developer Experience

**Improvements:**
- ✅ TypeScript autocomplete
- ✅ ESLint error detection
- ✅ Prettier code formatting
- ✅ Hot module replacement
- ✅ Source maps for debugging
- ✅ Path aliases (@core, @modules, etc.)

#### 🐛 Known Limitations

1. **Authentication:** Requires manual Anilist login
2. **First Load:** 2-3s delay for DOM replacement
3. **Settings Panel:** No export/import settings yet
4. **Testing:** No automated tests yet
5. **Other Modules:** Not yet implemented

#### 🔮 Roadmap

**Phase 3: Testing & Polish**
- Write unit tests (>80% coverage)
- Performance optimization
- Bug fixes
- Documentation updates

**Phase 4: Additional Modules**
- Hover Comments module
- Friend Activity module
- List Editor module
- Social Activity module

**Phase 5: Distribution**
- Chrome Web Store submission
- Firefox port
- Edge distribution

---

## Migration from v1

### Breaking Changes

- **New folder:** `anilist-ultimate` (separate from v1)
- **New manifest:** Manifest V3 format
- **Settings location:** Chrome sync storage (new keys)
- **No backward compatibility:** Fresh start

### Migration Steps

1. Keep v1 installed (backup)
2. Install v2 from `dist/` folder
3. Reconfigure settings in v2 settings panel
4. Test v2 functionality
5. Disable v1 when satisfied

### Data Migration

**Not Supported:**
- Settings must be reconfigured manually
- No automatic migration from v1

**Reason:** Complete architecture rewrite makes migration impractical

---

## Contributors

- **ExAstra** - Complete rewrite, architecture, implementation

---

## License

GPL-3.0 - Same as v1

---

**Built with ❤️ and TypeScript**
