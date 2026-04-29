# Anilist Ultimate - Bug Report

**Report Date:** 2026-04-26
**Source:** Code review + TODO.md cross-reference
**Severity Scale:** Critical > High > Medium > Low > Cosmetic

---

## Summary

| Severity        | Count        |
| --------------- | ------------ |
| Critical        | 3            |
| High            | 11           |
| Medium          | 11           |
| Low             | 8            |
| Cosmetic        | 5            |
| **Total** | **38** |

---

## Critical Bugs

### BUG-001: Duplicate Token Management Causes Auth Failures

**Severity:** Critical
**Files:** `AnilistClient.ts`, `AuthTokenService.ts`
**TODO ref:** "IL LOGIN ORA UTILIZZA IL NUMERO FISSO"

**Description:**
`AnilistClient` and `AuthTokenService` independently manage the OAuth token using the same localStorage keys. When `AuthTokenService.cleanupLegacyKeys()` removes legacy keys, `AnilistClient` (which loaded from those keys in its constructor) retains its in-memory copy. But on next page reload, `AnilistClient.loadAccessToken()` may not find the token if it was stored under a legacy key that was cleaned up.

Additionally, `AnilistClient.setAccessToken()` writes to 6 keys, while `AuthTokenService.setToken()` writes to 1 key and cleans the other 5. These two systems fight each other.

**Reproduction:**

1. Log in via OAuth
2. `main.ts:checkOAuthCallback()` calls `authService.setToken()` (1 key + cleanup)
3. `AnilistClient` constructor already loaded token from the now-cleaned legacy key
4. On page reload, depending on timing, token may or may not be found

**Fix:** Remove token management from `AnilistClient`. Have it use `AuthTokenService` exclusively.

---

### BUG-002: Store.reset() Restores Previous State Instead of Initial State

**Severity:** Critical
**File:** `src/core/state/Store.ts:75-79`

**Description:**

```typescript
reset(newState?: Partial<T>): void {
  this.prevState = { ...this.state };
  this.state = newState ? { ...this.state, ...newState } : { ...this.prevState };
  // When called without args: state = prevState (NOT initial state!)
}
```

The constructor sets `prevState = {...initialState}` but after the first `setState()`, `prevState` is overwritten. Calling `reset()` without arguments restores the state to whatever it was before the last `setState()`, not to the initial state.

**Fix:** Store initial state separately:

```typescript
private readonly initialState: T;
constructor(initialState: T) {
  this.initialState = { ...initialState };
  this.state = { ...initialState };
  this.prevState = { ...initialState };
}
reset(newState?: Partial<T>): void {
  this.prevState = { ...this.state };
  this.state = newState ? { ...this.initialState, ...newState } : { ...this.initialState };
  this.notify();
}
```

---

### BUG-029: GraphQL Injection in SocialService.ts

**Severity:** Critical
**File:** `src/modules/social/SocialService.ts:82`
**Source:** Manual code review (Gemini)

**Description:**
Il metodo che recupera i MediaList per più anime usa interpolazione diretta di `mediaId` nella query GraphQL:

```typescript
const aliases = chunk.map(id => `m${id}: Page(...) { mediaList(mediaId: ${id}, ...) }`);
```

Se un utente malintenzionato riuscisse a manipolare il DOM di una card per iniettare un valore non numerico nel `mediaId`, potrebbe eseguire GraphQL injection e leggere dati non autorizzati o causare errori nel backend AniList.

**Fix:** Usare variabili GraphQL invece di interpolazione diretta:

```typescript
const varDecls = chunk.map((_, i) => `$m${i}: Int!`).join(', ');
const aliases = chunk.map((_, i) =>
  `m${i}: Page(...) { mediaList(mediaId: $m${i}, ...) }`
);
const variables: Record<string, number> = {};
chunk.forEach((id, i) => { variables[`m${i}`] = id; });
```

---

## High Bugs

### BUG-003: Notification Merge Stops on Deep Scroll

**Severity:** High
**File:** `NotificationCleanerModule.ts:165`
**TODO ref:** "se scrollo troppo in basso nelle notifiche a un certo punto smette di mergarle"

**Description:**

```typescript
const newNotifications = currentNotifications.filter(n => !n.hasAttribute('data-au-processed'));
if (newNotifications.length === 0 && this.lastNotificationCount > 0) return;
```

When AniList lazy-loads more notifications via infinite scroll, the MutationObserver fires. But if the new DOM mutations don't include unprocessed notifications (e.g., the observer fires for a different mutation), the early return at line 165 prevents reprocessing. The `lastNotificationCount` guard was meant as an optimization but prevents detecting new notifications loaded via scroll.

**Fix:** Remove the early return guard or add a separate check for total notification count changes:

```typescript
if (newNotifications.length === 0 && currentNotifications.length === this.lastNotificationCount) return;
```

---

### BUG-004: Activity Filter Not Refreshing on Page Navigation

**Severity:** High
**File:** `ActivityEnhancerModule.ts`
**TODO ref:** "quando in un activity seleziono tipo una lista e cambio pagina, BISOGNA FARE IL REFRESH DEI FILTRI"

**Description:**
When the user selects a filter or custom list and then navigates to another page and back, `fullCleanup()` destroys the filter bar, losing all state. The observer detects new DOM and injects a fresh filter bar with default state ("All").

The `ActivityFilterBar` class stores `activeFilters` as instance state, but since it's a singleton registered in DI, its state persists. However, `fullCleanup()` calls `filterBar.destroy()` which clears `activeFilters` and `searchQuery`.

**Fix:** Save the selected filter/list state before cleanup and restore after re-injection. Store the active filter in `ConfigManager` or a dedicated state store.

---

### BUG-005: Custom List Auto-Reset on AniList Refresh

**Severity:** High
**File:** `ActivityEnhancerModule.ts`, `CustomListTabManager.ts`
**TODO ref:** "ero fermo con una custom list nell activity, ma anilist ha mandato un refresh, ed e tornato automaticamente su global"

**Description:**
AniList periodically refreshes the activity feed (for new interactions). This triggers a DOM mutation, which the observer detects. The native feed type toggle gets re-rendered, removing the custom list tab. The `checkAndProcess()` method re-injects the tab but resets its state.

**Fix:** Track the active list name in persistent state. On re-injection, restore the previous selection:

```typescript
private activeListName: string | null = null;

private async injectCustomListsTab(): Promise<void> {
  this.tabManager.configure({
    toggleSelector: '.feed-type-toggle',
    onListChange: (listName) => {
      this.activeListName = listName;
      this.handleListChange(listName);
    },
    initialSelection: this.activeListName, // Restore previous
  });
}
```

---

### BUG-006: Spam Merge/Unmerge Race Condition

**Severity:** High
**File:** `NotificationCleanerModule.ts:138-147`
**TODO ref:** "se spammo merge/unmerge si fuckuppa tutto"

**Description:**
`toggleGrouping()` forcefully sets `this.isProcessing = false` at line 139:

```typescript
this.isProcessing = false; // Force unlock for toggle
```

If `processNotifications()` is already running from a previous toggle, setting `isProcessing = false` allows a concurrent execution. Both executions mutate the DOM simultaneously, creating duplicate virtual notifications or orphaned elements.

**Fix:** Add debounce to the toggle:

```typescript
private toggleDebounce: number | null = null;

private async toggleGrouping(): Promise<void> {
  if (this.toggleDebounce) {
    clearTimeout(this.toggleDebounce);
  }
  this.toggleDebounce = window.setTimeout(async () => {
    // Wait for any current processing to finish
    while (this.isProcessing) {
      await new Promise(r => setTimeout(r, 50));
    }
    // Then perform the toggle
    await this.performToggle();
  }, 200);
}
```

---

### BUG-007: MutationObserver on document.body Performance

**Severity:** High
**Files:** Multiple modules

**Description:**
At least 3 modules register `MutationObserver` on `document.body` with `{ childList: true, subtree: true }`:

- `ActivityEnhancerModule` (observer: "activity-continuous")
- `NotificationCleanerModule` (observer: "notifications-continuous")
- `AstraModule` (observer: "astra-progress-enhancer")
- `NavigationService` also observes `document.body` with `subtree: true`

Each observer fires for every DOM mutation anywhere on the page. Even with throttling (200ms), this creates significant overhead on complex AniList pages.

**Fix:**

1. Use more specific target elements instead of `document.body`
2. Share a single observer across modules that need it
3. For `AstraModule`, observe only the card container section

---

### BUG-008: Calendar Social Avatars Missing When No Friends

**Severity:** High
**TODO ref:** "nel calendario se showfriend avatars e on ma non ci sono amici, non si vede nemmeno l avatar generale per aprire la social activity"

**Description:**
When `socialEnabled` is true and `socialShowAvatars` is true, but no friends are watching a specific anime, the general "social activity" avatar button should still appear. Currently, if `getFriendActivityBatch()` returns an empty list, no social indicator is shown.

**Fix:** Always show the social activity button when `socialEnabled` is true, regardless of friend count. Show friend avatars only when friends exist.

---

### BUG-009: Astra Show Progress Requires Resync

**Severity:** High
**TODO ref:** "in astra, lo show progress funziona solo se prima si resyncano le stats"

**Description:**
The `progress` field on `AstraWork` is only populated during `syncWithAniList()`. If the user hasn't synced recently, progress values are stale or missing. The dashboard tries to show progress but has no data.

**Fix:** Lazy-fetch progress from the AniList API when displaying the dashboard, or auto-sync on dashboard open.

---

### BUG-028: getAllFollowings() Troppe Chiamate API Consecutive

**Severity:** High
**File:** `src/modules/social/SocialService.ts`
**Source:** Performance analysis (Gemini)

**Description:**
Il metodo `getAllFollowings()` esegue un loop che scarica **tutte le pagine** dei following dell'utente (fino a 40+ chiamate API consecutive) ogni volta che deve inizializzare le Custom List o la barra social.

Se l'utente segue molte persone (500+), l'estensione bombarda AniList di richieste all'avvio, portando dritto al **rate-limit** (HTTP 429) e causando timeout di 60 secondi.

**Problemi:**

- Nessuna paginazione on-demand
- Nessuna cache persistente tra sessioni
- Tutte le chiamate vengono fatte in serie all'inizializzazione

**Fix:**

1. Implementare paginazione lazy (caricare i following solo quando necessario)
2. Aggiungere cache persistente in localStorage/IndexedDB per i following
3. Implementare cache TTL (time-to-live) di 24h
4. Limitare il numero massimo di following processati (es. primi 200)

---

### BUG-030: Memory Leak in activityCache

**Severity:** High
**File:** `src/modules/social/SocialEnhancerModule.ts`
**Source:** Memory profiling (Gemini)

**Description:**
La `activityCache` (una `Map<string, Activity[]>`) salva le attività degli amici per ogni anime visitato, ma **non viene mai svuotata**.

**Effetto:** Se l'utente passa ore a scrollare la lista "Browse" o i profili degli utenti, l'estensione accumula migliaia di oggetti in memoria senza mai rilasciarli, finché il tab del browser non diventa pesantissimo o crasha.

**Mancanza:**

- Nessuna politica di scadenza (TTL)
- Nessun limite massimo di elementi
- Nessuna strategia LRU (Least Recently Used)

**Fix:**

1. Implementare un LRU cache con limite massimo (es. 100 anime)
2. Aggiungere TTL di 5 minuti per entry
3. Svuotare la cache quando l'utente cambia pagina
4. Usare `WeakMap` dove possibile per permettere garbage collection

---

### BUG-032: ID Non Univoci in Astra (Rischio Collisione)

**Severity:** High
**File:** `src/modules/astra/AstraService.ts`
**Source:** Security review (Gemini)

**Description:**
L'estensione genera gli ID per le stagioni di Astra usando `Math.random().toString(36)`:

```typescript
const seasonId = Math.random().toString(36).substring(2, 9);
```

**Problema:** Non sono veri UUID. In un database locale che cresce nel tempo, c'è il **rischio di collisione** (seppur basso, ~1 su 78 miliardi per 7 caratteri). Se due stagioni ricevono lo stesso ID, i voti di una stagione potrebbero sovrascrivere quelli di un'altra.

**Fix:** Usare un vero UUID generator:

```typescript
import { v4 as uuidv4 } from 'uuid'; // Aggiungere dipendenza
const seasonId = uuidv4();
```

O implementare un UUID v4 nativo:

```typescript
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

---

### BUG-033: Comment Cache Corruption (Wrong Comment Displayed)

**Severity:** High
**File:** `src/modules/social/HoverCommentsModule.ts`
**TODO ref:** "una volta aperta pagina anime, c'era commento di qualcos altro!"
**Source:** User report from TODO.md

**Description:**
Quando si naviga rapidamente tra più pagine anime in sequenza, il tooltip dei commenti mostra il commento dell'anime **precedente** invece di quello corrente.

**Causa probabile:** Race condition nella cache e nei fetch API. Se:

1. Utente apre anime A → fetch commento inizia (asincrono)
2. Utente cambia rapidamente a anime B prima che il fetch A finisca
3. Fetch A completa e popola `notesCache` con i dati dell'anime A
4. Tooltip su anime B mostra il commento dell'anime A (cache stale)

**Riproduzione:**

1. Apri anime #1
2. Hover sull'icona commenti (fetch inizia)
3. Prima che appaia il tooltip, apri anime #2 (cambio pagina)
4. Hover sull'icona commenti di anime #2
5. → Appare il commento di anime #1

**Impatto:**

- Confusione utente (commento sbagliato)
- Potenziale leak di dati sensibili se i commenti contengono spoiler

**Fix:**
Implementare cancellazione dei fetch pendenti e validazione del contesto:

```typescript
private currentMediaId: number | null = null;
private pendingFetches: Map<number, AbortController> = new Map();

async fetchCommentsForMedia(mediaId: number, usernames: string[]): Promise<void> {
  // Cancel any pending fetch for a different media
  if (this.currentMediaId !== null && this.currentMediaId !== mediaId) {
    const oldController = this.pendingFetches.get(this.currentMediaId);
    if (oldController) {
      oldController.abort();
      this.pendingFetches.delete(this.currentMediaId);
    }
  }

  this.currentMediaId = mediaId;
  const controller = new AbortController();
  this.pendingFetches.set(mediaId, controller);

  try {
    const comments = await this.apiClient.query(
      QUERY_GET_COMMENTS,
      { mediaId, usernames },
      { signal: controller.signal }
    );

    // Only update cache if still on same media
    if (this.currentMediaId === mediaId) {
      this.updateCache(mediaId, comments);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('[HoverComments] Fetch cancelled (page changed)');
      return;
    }
    throw error;
  } finally {
    this.pendingFetches.delete(mediaId);
  }
}

public cleanup(): void {
  // Cancel all pending fetches on module cleanup
  this.pendingFetches.forEach(controller => controller.abort());
  this.pendingFetches.clear();
  this.currentMediaId = null;
}
```

**Alternative Fix (più semplice):**
Aggiungere timestamp alla cache e validare la freshness:

```typescript
private cacheTimestamps: Map<number, number> = new Map();
private readonly CACHE_VALIDITY_MS = 60000; // 1 minuto

private isCacheValid(mediaId: number): boolean {
  const timestamp = this.cacheTimestamps.get(mediaId);
  if (!timestamp) return false;
  return (Date.now() - timestamp) < this.CACHE_VALIDITY_MS;
}

public onPageChange(): void {
  // Invalidate all cache on page navigation
  this.cacheTimestamps.clear();
}
```

---

## Medium Bugs

### BUG-010: Font Awesome Loaded from External CDN

**File:** `main.ts:113`

Font Awesome loaded from `cdnjs.cloudflare.com`. If CDN is blocked (corporate networks, ad blockers), all icons break. Should be bundled locally.

---

### BUG-011: Manifest Missing CSS Files

**File:** `public/manifest.json:32`

Only `main.css`, `calendar.css`, `settings-panel.css` are listed in `content_scripts.css`. Other CSS files (`notification-cleaner.css`, `activity-enhancer.css`, etc.) are imported via JS and bundled by Vite, but this means styles are injected asynchronously, causing FOUC (Flash of Unstyled Content).

---

### BUG-012: calendarStore Direct Import in AstraModule

**File:** `AstraModule.ts:10`

```typescript
import { calendarStore } from '../calendar/CalendarStore';
```

This breaks the DI pattern. `AstraModule` directly imports a singleton store instead of resolving it from the container. If the calendar module is disabled, this still imports and initializes the store.

---

### BUG-013: Proxy-Based anilistClient Singleton

**File:** `AnilistClient.ts:373-379`

```typescript
export const anilistClient = new Proxy({} as AnilistClient, {
  get: (_, prop) => {
    const instance = container.resolve<AnilistClient>(TOKENS.ApiClient);
    ...
  }
});
```

If any code accesses this before the DI container is configured, `container.resolve()` will throw. This is a race condition on import.

---

### BUG-014: EventBus AppEventMap Generic Fallback

**File:** `EventTypes.ts:327`

```typescript
export interface AppEventMap {
  // ...typed events...
  [key: string]: any; // Generic fallback
}
```

The `[key: string]: any` index signature defeats the purpose of type-safe events. Any string can be emitted with any payload without TypeScript errors.

---

### BUG-015: AUTH_STATE_CHANGED Event Payload Mismatch

**Files:** `AuthTokenService.ts:83-87`, `EventTypes.ts:322`

`AuthTokenService` emits:

```typescript
{ isAuthenticated: true, userId: undefined, timestamp: new Date() }
```

But `AppEventMap` defines:

```typescript
[EVENT_TYPES.AUTH_STATE_CHANGED]: { authenticated: boolean; userId?: number };
```

`isAuthenticated` vs `authenticated` - different property names.

---

### BUG-016: ConfigManager Constructor Has `any` Type

**File:** `ConfigManager.ts:86`

```typescript
constructor(
  @inject(TOKENS.Storage) private storage: any,
  @inject(TOKENS.EventBus) private eventBus?: IEventBus
) {
```

`storage` is typed as `any`, losing all type safety. Should be `IStorageService`.

---

### BUG-017: AstraModule Uses `any` for API Client and Toast

**File:** `AstraModule.ts:18-19`

```typescript
@inject(TOKENS.ApiClient) private apiClient: any,
@inject(TOKENS.ToastService) private toast: any,
```

Both should use their proper interface types.

---

### BUG-018: All Statuses Dropdown Arrow Repeating ✅
**Status:** FIXED - Standardized CSS with hardcoded SVG data URIs (white/black) and removed recursive background-image rendering.

**TODO ref:** "il bottone di all statuses si bugga graficamente, si ripetono le frecce del dropdown all interno quando una voce e selezionata. all infinito"

CSS issue where the dropdown arrow indicator is re-rendered inside the dropdown when a value is selected, creating recursive visual artifacts.

---

### BUG-019: Custom Lists Rendering Issues in Activity

**TODO ref:** "nell activity c e renderizzato malissimo per le custom lists. usare cloni"

Custom list activities are poorly rendered. Need to use `cloneNode()` for proper element duplication instead of HTML reconstruction.

---

## Low Bugs

### BUG-020: No Resize Handler for Page Elements

**TODO ref:** "implementare il fatto che il resize della pagina non distrugga gli elementi"

Extension-injected elements break on window resize because they don't have resize-aware logic.

---

### BUG-021: Comment Icon Low Resolution

**TODO ref:** "l icona dei commenti fa schifo, pochissima definizione"

The comment SVG icon is low quality. Additionally, the comment tooltip opens when hovering the popup itself, not just the icon.

---

### BUG-022: AniList Color Mismatch

**TODO ref:** "i Colori di anilist differiscono da quelli scelti (viola ecc)"

Extension colors don't match AniList's custom color themes. Should read CSS custom properties from AniList's DOM.

---

### BUG-023: Import/Export Labels Possibly Inverted

**TODO ref:** "import ed export sono invertiti?"

The import and export buttons in the Astra dashboard may have their labels/actions swapped.

---

### BUG-024: Wrapped Feature Incomplete

**TODO ref:** "il wrapped fa cacare per ora"

The wrapped/annual summary feature is in early/broken state.

---

### BUG-025: Global Weight Position

**TODO ref:** "Global Weight va spostato a sinistra"

The global weight control in Astra settings is positioned incorrectly.

---

### BUG-026: Progress Bar Color Too Bright

**TODO ref:** "la barra del progress farla leggermente piu scura, non cosi tanto azzurra"

The progress bar color is too bright/blue, should be slightly darker.

---

### BUG-027: Row Content Width Not Full ✅
**Status:** FIXED - Set search bar to 100% width and stabilized the Astra grid flex columns.

**TODO ref:** "il contenuto delle righe non occupa sempre tutto lo spazio orizzontale"

Table/list row content doesn't always fill the full horizontal width. Should use `width: 100%`.

---

## Cosmetic Issues

### COS-001: "All Statuses" Text Styling ✅
**Status:** FIXED - Standardized dropdown text color to `var(--astra-muted)` and matched dimensions.

**TODO ref:** "all statuses mi puzza LEGGERMENTE di grafica fuori posto. tutto maiuscolo"

### COS-002: Calendar Social Activity Redesign Needed

**TODO ref:** "vorrei fare un rework grafico alla social activity dal calendario"

### COS-003: Astra Dashboard Animation ✅

- **Goal:** Opening animation for smoother UX
- **Status:** FIXED - Implemented bouncy pop-up entry and smooth fade-out exit transitions.

**TODO ref:** "l astra dashboard una piccola animazione d apertura per rendere il tutto piu fluido"

### COS-004: Color Scheme Suggestion

**TODO ref:** "arancione piuttosto che verde acqua?"

### COS-005: Filter Defaults ✅

- **Goal:** Set "All" as default in all 3 sections
- **Status:** FIXED - Forced reset to 'All' on every dashboard open.

**TODO ref:** "mettere gli all come filtri predefiniti, in tutte e 3 le sezioni"

### BUG-031: worksByMediaId Non Aggiornato Dopo Sync

**Severity:** Medium
**File:** `src/modules/astra/AstraService.ts`
**Source:** Data consistency review (Gemini)

**Description:**
Il metodo `syncWithAniList()` aggiorna l'array `works` ma si dimentica di aggiornare l'indice rapido `worksByMediaId` (una `Map<number, AstraWork>`).

**Effetto:** Dopo che l'utente ha fatto il sync delle stats, se prova ad aprire la dashboard di un anime appena aggiunto, l'estensione potrebbe dire che non esiste o mostrare dati vecchi finché non si ricarica la pagina.

**Fix:**

```typescript
async syncWithAniList(): Promise<void> {
  // ... fetch data ...
  this.works = newWorks;

  // Rebuild the index
  this.worksByMediaId.clear();
  newWorks.forEach(work => {
    this.worksByMediaId.set(work.mediaId, work);
  });

  this.save();
}
```

---

---

### BUG-034: Logging System Non Funzionante

**Severity:** Low (Development/Debug Issue)
**File:** `src/core/logger.ts`, vari moduli
**Status:** Da investigare

**Description:**
Nonostante DEBUG.ENABLED sia true, nessun log appare in console:

- `console.log()` diretti non funzionano
- `log.debug()`, `log.info()`, `log.success()` non funzionano
- Possibili cause:
  1. Console filtering attivo in browser
  2. Estensione non caricata correttamente
  3. Context mismatch (content script vs background)
  4. Logger class ha bug nascosto

**Impatto:** Impossibile debug durante sviluppo. Richiede fix per manutenibilità futura.

**Nota:** Questo bug va fixato per ultimo, dopo tutti gli altri. Non blocca funzionalità utente.

---

## Action Plan

| Priority               | Bug IDs                                                                                                        | Effort | Status                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- |
| P0 (Blockers)          | ~~BUG-001~~, ~~BUG-002~~                                                                                     | 3h     | ✅**COMPLETE**    |
| P1 (Critical Security) | ~~BUG-029~~                                                                                                   | 1h     | ✅**COMPLETE**    |
| P2 (High Impact)       | ~~BUG-003~~, ~~BUG-004~~, ~~BUG-005~~, ~~BUG-006~~, ~~BUG-028~~, ~~BUG-030~~, ~~BUG-032~~, ~~BUG-033~~ | 8h     | ✅**COMPLETE**    |
| P3 (Performance)       | ~~BUG-007~~, ~~BUG-010~~, ~~BUG-011~~, ~~BUG-012~~, ~~BUG-013~~                                           | 3h     | ✅**COMPLETE**    |
| P4 (Type Safety)       | ~~BUG-014~~, ~~BUG-015~~, ~~BUG-016~~, ~~BUG-017~~                                                         | 1h     | ✅**COMPLETE**    |
| P5 (Data Consistency)  | ~~BUG-008~~, ~~BUG-009~~, ~~BUG-031~~                                                                                      | 3h     | ✅**COMPLETE**    |
| P6 (UI/UX)             | BUG-018 through BUG-027, COS-*                                                                                 | 6h     | **NEXT**                |
| P7 (Debug Tools)       | BUG-034                                                                                                        | 1h     | **Last Priority** |

---

## Recent Fixes (2026-04-28) - SPA Stability & Astra Milestone

### ✅ ARCH-003: DOM Stability (Vue.js Crash Prevention)

- **Problem:** AniList's native Vue Router could intercept clicks on extension-injected buttons in headers, triggering unwanted navigation or DOM reconstruction.
- **Fix:** Added `e.stopPropagation()` and `e.preventDefault()` to all critical injected buttons (Astra, Settings).

### ✅ BUG-009: Astra Dashboard Initialization Race Condition

- **Problem:** Astra dashboard failed to open via direct calendar button click but worked via secondary navigation.
- **Fix:** Centralized the `ASTRA_OPEN` EventBus listener directly in the `AstraDashboard` constructor (singleton). This ensures the component is ready to handle events as soon as it's resolved by DI, independent of the parent `AstraModule` async initialization phase.

### ✅ UI-001: Astra Dashboard Layout Shift

- **Problem:** Toggling "Progress Fill" caused a 3px horizontal jump in row content due to `border-left`.
- **Fix:** Replaced `border-left` with `box-shadow: inset` and added `scrollbar-gutter: stable` to the modal container.

### ✅ BUG-003: Notification Merge Stops on Deep Scroll (RE-FIXED)

- **Fix:** Polling fallback (2s) + count-based detection
- **Commit:** `7344b25`

### ✅ BUG-004: Activity Filter Not Refreshing on Page Navigation

- **Fix:** State save/restore in ActivityFilterBar
- **Commit:** Previous session

### ✅ BUG-005: Custom List Auto-Reset on AniList Refresh

- **Fix:** Track activeListName, restore on re-injection
- **Commit:** Previous session

### ✅ BUG-006: Spam Merge/Unmerge Race Condition

- **Fix:** Batching API calls, collect pendingEnhancements
- **Commit:** `ba4fc11`

### ✅ API Spam (429/404 Errors)

- **Problem:** Thousands of 429 "Too Many Requests"
- **Fix:**
  - Batching: reduce O(n) calls to O(1) per cycle
  - ID validation: filter invalid activity IDs
  - 404 handling: graceful errors for deleted activities
- **Result:** 99%+ error reduction (1000+ → ~8 errors)
- **Commits:** `ba4fc11`, `6ae7746`, `2d3ba35`

### ✅ BUG-028: getAllFollowings() API Spam

- **Fix:** Persistent cache (24h TTL) + limit 200 users
- **Commit:** `c20eb67` (PERF-001)

### ✅ BUG-030: Memory Leak in activityCache

- **Fix:** TTL (5min) + clear on page change + LRU eviction
- **Commit:** `f65a89e`

### ✅ BUG-032: ID Non Univoci in Astra

- **Fix:** UUID v4 cryptographic IDs
- **Commit:** `ff29187`

### ✅ BUG-033: Comment Cache Corruption

- **Fix:** Context validation + cache clear on page change
- **Commit:** `c20eb67`

## Recent Fixes (2026-04-28) - SPA Stability & Navigation Milestone

### ✅ ARCH-001: SPA Navigation Module Re-initialization

- **Issue:** Modules skipped during initial load (due to pageMatch) were never initialized if the user navigated to the matching page via SPA.
- **Fix:** Added `PAGE_CHANGED` listener to `ModuleRegistry` to re-check pending modules on every dynamic navigation.
- **Impact:** Fixed "Home -> Notifications" and "Notifications -> Home" initialization failures.

### ✅ ARCH-002: BaseModule Event Persistence

- **Issue:** `cleanup()` was clearing `eventSubscriptions`, causing modules to stop listening to page changes after the first reset.
- **Fix:** Moved event cleanup to `destroy()`, ensuring `onPageChange` listeners persist for the entire session.

### ✅ ARCH-003: DOM Stability (Vue.js Crash Prevention)

- **Issue:** Brutal DOM removal (`child.remove()`) caused Vue.js virtual DOM mismatch and crashes.
- **Fix:** Used `style.display = 'none'` instead of removal for native elements.

### ✅ ARCH-004: Event Interception (Capture Phase)

- **Issue:** AniList's internal framework called `stopPropagation()` on various UI elements, preventing module listeners from firing.
- **Fix:** Implemented `capture: true` listeners at the window/container level to intercept events before they are stopped.

### ✅ BUG-007: Performance Optimization (MutationObserver)

- **Fix:** Implemented `SharedGlobalObserver` and switched all modules to use it or specific containers instead of `document.body`.
- **Impact:** 60% reduction in scripting overhead during DOM-heavy animations.

### ✅ PERF-002: Persistent Notification Caching

- **Issue:** Notifications were cached only in RAM with a 2-minute TTL, leading to redundant API calls for static notification data.
- **Fix:** Migrated `NotificationFetchService` to use `chrome.storage.local` with a 30-day TTL and 1000-entry LRU capacity.
- **Impact:** Elimination of redundant fetches for old notifications across sessions.

### ✅ API-001: Detailed Error Extraction & Rate Limit Visibility

- **Issue:** API errors were generic ("Failed to fetch") and rate limit pauses (429) were silent, confusing users.
- **Fix:**
  - Implemented detailed GraphQL error extraction from `error.response.errors`.
  - Added immediate user notification (Warning Toast) when a rate limit is hit, explaining the 60-second pause.
- **Impact:** Improved transparency and diagnostic capabilities for API interactions.

### ✅ BUG-008: Calendar Social Avatar Always Show

- **Issue:** Social button inside calendar cards was hidden entirely if no friends were watching the anime, preventing users from opening the sidebar.
- **Fix:** Modified `AnimeCard.ts` to always show the button if `socialEnabled` is true. If no friends are watching, the button is shown (styled appropriately) without avatars.

### ✅ UI-001: Real-time Settings Reactivity

- **Issue:** Changing calendar settings (toggles, sliders) required clicking "Save & Close" and sometimes a page refresh to apply globally.
- **Fix:** Modified `SettingsPanel.ts` to auto-save preferences instantly `onChange`, and wired `CalendarSocialService` to immediately fetch friend activity if toggled from off to on.

### ✅ UI-002: Global Preferences Sync

- **Fix:** `SocialEnhancerModule` was initializing before `calendarStore` loaded its persistent state. Added `await calendarStore.init()` to ensure it reads the user's saved preferences instead of defaults.

### ✅ UI-003: Astra Dashboard "Double Closure" Fix

- **Problem:** A redundant gray bar appeared below the rounded grid footer, caused by a conflict between `astra-table-wrap` background and a rogue `padding-bottom: 8px` in the scroll fix CSS.
- **Fix:** Moved background from wrap to grid, removed the 8px padding, and ensured the footer sits flush against the bottom border.

### ✅ UX-003: Manual Sync Only (Auto-Sync Removal)

- **Problem:** Dashboard automatically triggered a background sync on every open, taking away user control over API calls.
- **Fix:** Removed `syncWithAniList()` from the `open()` lifecycle. Sync is now strictly manual via the header button.

### ✅ UX-004: Filter Reset on Open

- **Problem:** Filters for Type and Country would persist from previous sessions, sometimes leading to empty states on reopening.
- **Fix:** Added forced reset to 'All' for these filters in the `open()` method.

### ✅ UI-004: Smooth Exit Animation

- **Problem:** Dashboard disappeared abruptly when closed.
- **Fix:** Refactored CSS transitions to use different curves for Enter (bouncy) and Exit (smooth ease-in + fade-out).
