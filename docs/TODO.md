# AniList Ultimate v2 - TODO List

**Last Updated:** 2026-04-27
**Status:** P2 Complete (8/8) - Moving to P1 and Caching System

---

## 🔴 P1 - CRITICAL SECURITY (Next Priority)

### BUG-029: GraphQL Injection in SocialService
- **File:** `src/modules/social/SocialService.ts:89`
- **Severity:** Critical
- **Effort:** 30min
- **Issue:** MediaId interpolated directly in GraphQL query
  ```typescript
  const aliases = chunk.map(id => `m${id}: Page(...) { mediaList(mediaId: ${id}, ...) }`)
  ```
- **Fix:** Use GraphQL variables instead of string interpolation
  ```typescript
  const varDecls = chunk.map((_, i) => `$m${i}: Int!`).join(', ');
  const aliases = chunk.map((_, i) => `m${i}: Page(...) { mediaList(mediaId: $m${i}, ...) }`);
  const variables = {};
  chunk.forEach((id, i) => { variables[`m${i}`] = id; });
  ```
- **Impact:** Prevents potential data leaks or GraphQL injection attacks

---

## 🟡 SISTEMA DI CACHING INTELLIGENTE (High Priority - NEW)

### Obiettivo
Implementare caching con **fingerprint-based invalidation** invece di solo TTL:
1. Leggi dati attuali dalla pagina
2. Genera fingerprint (hash/IDs)
3. Confronta con cache.fingerprint
4. Se uguale → usa cache (NO API call)
5. Se diverso → API call + aggiorna cache

### Task List

#### 1. Fix scoreCache Memory Leak (ActivityService)
- **File:** `src/modules/activity/ActivityService.ts`
- **Issue:** scoreCache cresce all'infinito, no TTL, no eviction
- **Fix:**
  - Aggiungere LRU cache (max 100 entries)
  - TTL 5 minuti
  - Clear on page change

#### 2. Intelligent Review Caching
- **File:** `src/modules/reviews/` (da creare service?)
- **Current:** Nessun caching
- **Goal:**
  - Leggi 4 review IDs dalla homepage
  - Confronta con cache fingerprint [id1, id2, id3, id4]
  - Se diverso → fetch + cache
  - Se uguale → skip API call

#### 3. Intelligent Calendar Caching
- **File:** `src/modules/calendar/CalendarStore.ts`
- **Current:** Nessun caching persistente
- **Goal:**
  - Cache in chrome.storage.local con TTL 30min
  - Fingerprint: hash di mediaIds + airingAt timestamps
  - Confronta prima di fare sync
  - Invalida se utente modifica progress

#### 4. Intelligent Notification Caching
- **File:** `src/modules/notifications/`
- **Current:** Nessun caching
- **Goal:**
  - Cache notification IDs + timestamps
  - Confronta con notifiche attuali DOM
  - Fetch solo se nuove notifiche rilevate

#### 5. Manual Cache Invalidation
- **Files:** Tutti i service con cache
- **Goal:**
  - Aggiungere `invalidateCache()` method
  - Esporlo nel settings panel
  - Trigger su user actions (follow/unfollow)

#### 6. Followings Cache Improvements
- **File:** `src/modules/social/SocialService.ts`
- **Current:** 24h TTL, no manual refresh
- **Fix:**
  - Aggiungere `refreshFollowings()` method
  - Button nel settings per force refresh
  - Auto-invalidate su follow/unfollow events (se possibile rilevare)

---

## 🟢 P3 - PERFORMANCE (3h effort)

### BUG-007: MutationObserver Optimization
- **Files:** Multiple modules
- **Issue:** 4+ observers su document.body causano overhead
- **Fix:**
  1. Shared single observer pattern
  2. Target specifici containers invece di document.body
  3. Throttle più aggressivo dove possibile

### BUG-010: Font Awesome Local Bundle
- **File:** `src/main.ts:138`
- **Issue:** CDN esterno (cloudflare) - fail in corporate networks
- **Fix:** Bundle Font Awesome icons locally in assets/

### BUG-011: Manifest CSS Bundling
- **File:** `public/manifest.json`
- **Issue:** CSS importati via JS → FOUC (Flash of Unstyled Content)
- **Fix:** List all CSS in manifest.json content_scripts.css

### BUG-012: CalendarStore DI Pattern
- **File:** `src/modules/astra/AstraModule.ts:10`
- **Issue:** Direct import breaks DI pattern
- **Fix:** Resolve from container via TOKENS.CalendarStore

### BUG-013: Proxy Singleton Race Condition
- **File:** `src/api/AnilistClient.ts:373`
- **Issue:** Proxy resolve before DI configured → error
- **Fix:** Lazy initialization or remove proxy pattern

---

## 🔵 P4 - TYPE SAFETY (1h effort)

### BUG-014: EventBus Generic Fallback
- **File:** `src/core/events/EventTypes.ts:327`
- **Issue:** `[key: string]: any` defeats type safety
- **Fix:** Remove generic fallback, force typed events only

### BUG-016: ConfigManager Any Type
- **File:** `src/core/config/ConfigManager.ts:86`
- **Issue:** storage: any instead of IStorageService
- **Fix:** Add proper interface type

### BUG-017: AstraModule Any Types
- **File:** `src/modules/astra/AstraModule.ts:18-19`
- **Issue:** apiClient: any, toast: any
- **Fix:** Use IApiClient and IToastService interfaces

---

## 🟣 P5 - DATA CONSISTENCY (3h effort)

### BUG-008: Calendar Social Avatar Always Show
- **File:** `src/modules/calendar/`
- **Issue:** Avatar button nascosto se no friends watching
- **Fix:** Always show button if socialEnabled, show avatars only if friends exist

### BUG-009: Astra Progress Without Resync
- **File:** `src/modules/astra/AstraModule.ts`
- **Issue:** Progress field stale unless user manually resyncs
- **Fix:** Lazy-fetch progress when opening dashboard

### BUG-031: worksByMediaId Index Not Updated
- **File:** `src/modules/astra/AstraService.ts`
- **Issue:** syncWithAniList() updates works[] but not worksByMediaId Map
- **Fix:** Rebuild index after sync:
  ```typescript
  this.worksByMediaId.clear();
  newWorks.forEach(work => this.worksByMediaId.set(work.mediaId, work));
  ```

---

## 🟤 P6 - UI/UX (6h effort)

### BUG-018: All Statuses Dropdown Arrow Repeat
- **Issue:** Arrow indicators repeat infinitely when value selected
- **Fix:** CSS fix for dropdown arrow

### BUG-019: Custom Lists Rendering
- **Issue:** Malrenduto in activity feed
- **Fix:** Use cloneNode() instead of HTML reconstruction

### BUG-020: Resize Handler
- **Issue:** Extension elements break on window resize
- **Fix:** Add resize event listeners

### BUG-021: Comment Icon Low Resolution
- **Issue:** SVG icon bassa qualità
- **Fix:** Higher quality SVG + fix hover area

### BUG-022: AniList Color Mismatch
- **Issue:** Extension colors don't match user's AniList theme
- **Fix:** Read CSS custom properties from AniList DOM

### BUG-023: Import/Export Labels
- **Issue:** Possibly inverted in Astra
- **Fix:** Verify and swap if needed

### BUG-024: Wrapped Feature
- **Issue:** Annual summary incomplete/broken
- **Fix:** Complete implementation

### BUG-025: Global Weight Position
- **Issue:** Positioned incorrectly in Astra
- **Fix:** Move to left

### BUG-026: Progress Bar Color
- **Issue:** Too bright blue
- **Fix:** Darker shade

### BUG-027: Row Content Width
- **Issue:** Doesn't fill horizontal space
- **Fix:** width: 100%

### COS-001: All Statuses Text
- **Issue:** All caps looks out of place
- **Fix:** Title case

### COS-002: Calendar Social Redesign
- **Goal:** Rework grafico social activity dal calendario

### COS-003: Astra Dashboard Animation
- **Goal:** Opening animation for smoother UX

### COS-004: Color Scheme
- **Suggestion:** Orange instead of teal?

### COS-005: Filter Defaults
- **Goal:** Set "All" as default in all 3 sections

---

## ⚫ P7 - DEBUG TOOLS (Last Priority)

### BUG-034: Logging System Not Working
- **Files:** `src/core/logger.ts`, multiple modules
- **Issue:**
  - DEBUG.ENABLED = true ma nessun log appare
  - console.log() diretti non funzionano
  - Possibili cause: context mismatch, browser filtering, extension not loaded
- **Fix:**
  1. Investigate why logs don't appear
  2. Verificare content script context
  3. Test con diversi log levels
  4. Aggiungere fallback logging method
- **Note:** Da fare PER ULTIMO - non blocca funzionalità utente

---

## ✅ COMPLETED (P0, P1 partial, P2)

### P0 - Blockers
- ✅ BUG-001: Dual token management
- ✅ BUG-002: Store.reset() bug

### P2 - High Impact (8/8)
- ✅ BUG-003: Notification merge on scroll
- ✅ BUG-004: Activity filter state
- ✅ BUG-005: Custom list auto-reset
- ✅ BUG-006: Merge/unmerge race
- ✅ BUG-028: getAllFollowings() spam
- ✅ BUG-030: Memory leak activityCache
- ✅ BUG-032: UUID Astra IDs
- ✅ BUG-033: Comment cache corruption

### Bonus
- ✅ API Spam: 99% reduction (1000+ → ~8 errors)
- ✅ HTTP 404: Validation + graceful handling
- ✅ HTTP 429: Batching + rate limiting

---

## 🎯 EXECUTION ORDER

1. **P1 Security** (30min)
   - BUG-029: GraphQL injection

2. **Caching Intelligente** (3-4h)
   - scoreCache fix
   - Review fingerprinting
   - Calendar caching
   - Notification caching
   - Manual invalidation
   - Followings refresh

3. **P3 Performance** (3h)
   - Observer optimization
   - Font Awesome bundle
   - Manifest CSS
   - DI fixes

4. **P4 Type Safety** (1h)

5. **P5 Data Consistency** (3h)

6. **P6 UI/UX** (6h)

7. **P7 Debug** (1h - LAST)

**Total Remaining:** ~17-18h
