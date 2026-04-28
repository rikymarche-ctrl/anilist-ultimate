# Anilist Ultimate v2 - Feature Requests & Enhancements

**Last Updated:** 2026-04-27
**Source:** TODO.md + User feedback
**Priority Scale:** Critical > High > Medium > Low

---

## Summary

| Priority | Count |
|----------|-------|
| High | 3 |
| Medium | 6 |
| Low | 5 |
| **Total** | **14** |

---

## High Priority Features

### FEAT-001: Module Toggle System (Settings Page)

**Priority:** HIGH
**Effort:** 6 hours
**TODO ref:** "OGNI MODULO DELL ESTENSIONE... SARÀ OPTABILE IN E OUT. OGNI UTENTE DALLE IMPOSTAZIONI DELL ESTENSIONE... POTRÀ DECIDERE COSA VUOLE."

**Description:**
Implementare una pagina di impostazioni accessibile dal browser (chrome://extensions o tramite popup) dove l'utente può abilitare/disabilitare singolarmente ogni modulo dell'estensione.

**Moduli da rendere configurabili:**
- ✅ Calendar
- ✅ Notification Cleaner
- ✅ Activity Enhancer
- ✅ Social Enhancements (avatars, friend activity)
- ✅ Hover Comments
- ✅ Astra
- ✅ Reviews
- ✅ Forum enhancements

**Requisiti:**
1. UI settings page con toggle switch per ogni modulo
2. Persistenza in `chrome.storage.sync` (sync tra dispositivi)
3. Hot reload: disabilitare modulo senza dover riavviare l'estensione
4. Default: tutti i moduli ON alla prima installazione
5. Export/Import configurazione

**Implementation:**
```typescript
// src/core/config/ModuleConfig.ts
interface ModuleSettings {
  calendar: { enabled: boolean };
  notifications: { enabled: boolean };
  activity: { enabled: boolean };
  social: { enabled: boolean };
  hoverComments: { enabled: boolean };
  astra: { enabled: boolean };
  reviews: { enabled: boolean };
  forum: { enabled: boolean };
}

class ModuleConfigManager {
  async getSettings(): Promise<ModuleSettings> {
    return chrome.storage.sync.get('moduleSettings');
  }

  async setModuleEnabled(moduleName: string, enabled: boolean): Promise<void> {
    const settings = await this.getSettings();
    settings[moduleName].enabled = enabled;
    await chrome.storage.sync.set({ moduleSettings: settings });

    // Emit event for hot reload
    this.eventBus.emit(EVENT_TYPES.MODULE_CONFIG_CHANGED, { moduleName, enabled });
  }
}
```

**UI Mockup:**
```
┌─────────────────────────────────────┐
│  Anilist Ultimate - Settings       │
├─────────────────────────────────────┤
│                                     │
│  📅 Calendar Module         [ON]   │
│  🔔 Notifications Cleaner   [ON]   │
│  📊 Activity Enhancer       [ON]   │
│  👥 Social Features         [ON]   │
│  💬 Hover Comments          [OFF]  │
│  ⭐ Astra Scoring           [ON]   │
│  📝 Reviews Enhancements    [OFF]  │
│  💭 Forum Tools             [OFF]  │
│                                     │
│  [Export Config] [Import Config]   │
└─────────────────────────────────────┘
```

---

### FEAT-002: Intelligent Caching System

**Priority:** HIGH
**Effort:** 8 hours
**TODO ref:** "un sistema di caching intelligente. se vado avanti e torno indietro non può fare così schifo. oltre che a cachare notifiche e reviews almeno dai"

**Description:**
Implementare un sistema di caching unificato e intelligente per ridurre le chiamate API e migliorare la navigazione avanti/indietro.

**Requisiti:**
1. **Cache persistente** (chrome.storage.local) per dati che cambiano raramente:
   - Following list (TTL: 24h)
   - Media details (TTL: 7 giorni)
   - User profiles (TTL: 1 giorno)

2. **Cache in-memory** (LRU) per dati volatili:
   - Activity feed (TTL: 5 minuti, max 100 entries)
   - Notifications (TTL: 2 minuti, max 50 entries)
   - Scores/Reviews (TTL: 10 minuti, max 200 entries)

3. **Smart invalidation**:
   - User action (like, comment) → invalidate related cache
   - Page refresh → keep cache, show stale + refetch
   - Manual sync → clear all cache

4. **Metrics tracking**:
   - Cache hit rate
   - API calls saved
   - Memory usage

**Implementation:**
```typescript
// src/core/cache/CacheService.ts
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class CacheService {
  private memoryCache: LRUCache<string, any>;
  private persistentCache: PersistentCache;

  async get<T>(key: string, fetcher: () => Promise<T>, options: CacheOptions): Promise<T> {
    // Check memory cache
    const memCached = this.memoryCache.get(key);
    if (memCached && !this.isExpired(memCached)) {
      return memCached.data;
    }

    // Check persistent cache
    if (options.persistent) {
      const persisted = await this.persistentCache.get(key);
      if (persisted && !this.isExpired(persisted)) {
        this.memoryCache.set(key, persisted);
        return persisted.data;
      }
    }

    // Cache miss - fetch and store
    const data = await fetcher();
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: options.ttl
    };

    this.memoryCache.set(key, entry);
    if (options.persistent) {
      await this.persistentCache.set(key, entry);
    }

    return data;
  }
}
```

**Cache Strategy per modulo:**
- **Calendar**: Cache entries (persistent, 1 giorno)
- **Notifications**: Cache last 50 (memory, 2 minuti)
- **Activity**: Cache feed (memory, 5 minuti) + scores (persistent, 1 ora)
- **Social**: Cache following (persistent, 24h) + friend activity (memory, 10 minuti)
- **Astra**: Cache works (persistent, no TTL, manual invalidation)

---

### FEAT-003: Advanced Page Navigation Observers

**Priority:** HIGH
**Effort:** 4 hours
**TODO ref:** "setuppare qualche observer per il cambio di pagina perchè ogni volta devo refreshare tutto a mano, che palle"

**Description:**
Migliorare il sistema di NavigationService per gestire meglio i cambio pagina e il lifecycle dei componenti.

**Problemi attuali:**
- Alcuni componenti non si re-inizializzano dopo cambio pagina
- Filter state perso su navigazione
- Memory leak (componenti non cleaned up)

**Requisiti:**
1. **Lifecycle hooks** per ogni modulo:
   ```typescript
   interface ModuleLifecycle {
     onPageEnter(url: string): void;
     onPageLeave(url: string): void;
     onPageVisible(): void;
     onPageHidden(): void;
   }
   ```

2. **Route matching**:
   ```typescript
   navigationService.onRoute('/anime/:id', (params) => {
     // Module logic for anime page
   });
   ```

3. **State restoration**:
   - Salvare state dei filtri prima di leave
   - Restore state al return

4. **Automatic cleanup**:
   - Remove event listeners on leave
   - Clear intervals/timers
   - Abort pending fetches

**Implementation:**
```typescript
class NavigationService {
  private moduleLifecycles: Map<string, ModuleLifecycle> = new Map();

  registerModule(name: string, lifecycle: ModuleLifecycle): void {
    this.moduleLifecycles.set(name, lifecycle);
  }

  private handlePageChange(newUrl: string): void {
    const oldRoute = this.currentRoute;
    const newRoute = this.parseRoute(newUrl);

    // Notify modules leaving the page
    if (oldRoute) {
      this.moduleLifecycles.forEach((lifecycle, name) => {
        if (this.shouldModuleRun(name, oldRoute)) {
          lifecycle.onPageLeave(oldRoute.url);
        }
      });
    }

    // Notify modules entering the page
    this.moduleLifecycles.forEach((lifecycle, name) => {
      if (this.shouldModuleRun(name, newRoute)) {
        lifecycle.onPageEnter(newRoute.url);
      }
    });

    this.currentRoute = newRoute;
  }
}
```

---

## Medium Priority Features

### FEAT-004: Notification Message Privacy Detection

**Priority:** MEDIUM
**Effort:** 2 hours
**TODO ref:** "nelle notifiche capire se il messaggio 'sent' è segreto (occhiolino png) o pubblico"

**Description:**
Distinguere tra messaggi privati e pubblici nelle notifiche, mostrando un'icona diversa.

**Implementation:**
- Controllare la presenza dell'icona "occhiolino" nel DOM nativo di AniList
- Aggiungere classe CSS `.au-notification--private` per messaggi privati
- Mostrare icona 🔒 invece di 💬

---

### FEAT-005: Astra Private Lists Integration

**Priority:** MEDIUM
**Effort:** 3 hours
**TODO ref:** "in astra, aggiungere i Private, quelli default di anilist, come sezione"

**Description:**
Integrare le liste private di AniList come sezione dedicata in Astra, permettendo di applicare scoring anche a quelle.

**Requisiti:**
- Fetch private lists via API
- UI per visualizzarle separatamente
- Apply scoring globale anche alle private

---

### FEAT-006: Conditional Scoring Filters (Temporal Context)

**Priority:** MEDIUM
**Effort:** 6 hours
**TODO ref:** "filtri condizionali ai criteri per il voto. se do 3 alla grafica a un anime del 1990 non deve influire come se lo dessi ad uno di oggi"

**Description:**
Sistema di pesi dinamici basati su contesto temporale e altri fattori.

**Esempio:**
- Anime del 1990 con Animation score 3/10 → peso ridotto
- Anime del 2024 con Animation score 3/10 → peso normale

**Implementation:**
```typescript
interface ConditionalWeight {
  criterion: string;
  condition: (media: Media) => boolean;
  weightModifier: number; // 0.0 - 2.0
}

const temporalWeights: ConditionalWeight[] = [
  {
    criterion: 'animation',
    condition: (m) => m.releaseYear < 2000,
    weightModifier: 0.5 // Riduce peso del 50%
  },
  {
    criterion: 'soundtrack',
    condition: (m) => m.releaseYear < 1995,
    weightModifier: 0.7
  }
];
```

**UI:**
- Checkbox "Enable temporal context weighting"
- Slider per configurare threshold anni

---

### FEAT-007: Social Activity in Calendar for Custom Lists

**Priority:** MEDIUM
**Effort:** 4 hours
**TODO ref:** "vorrei fare un rework grafico alla social activity dal calendario (le custom lists non funzionano per nulla qua)"

**Description:**
Fixare e migliorare la visualizzazione della social activity per le custom lists nel calendario.

**Problemi:**
- Custom lists non mostrano friend activity
- UI poco chiara

**Fix:**
- Fetch friend activity anche per custom lists
- Redesign UI con card espandibili

---

### FEAT-008: Social Avatars for In-Progress Anime/Manga

**Priority:** MEDIUM
**Effort:** 3 hours
**TODO ref:** "estensione funzionalità social con avatar anche a anime e manga in progress, essenzialmente il bottone a pillola"

**Description:**
Aggiungere il bottone "pillola" con avatars degli amici anche nelle pagine di anime/manga in progress (non solo nel calendario).

**Implementation:**
- Inject pill button in media page sidebar
- Fetch friend activity for current media
- Show avatars + click → open social modal

---

### FEAT-009: Better Comment Icon & Hover Behavior

**Priority:** MEDIUM
**Effort:** 2 hours
**TODO ref:** "l icona dei commenti fa schifo, pochissima definizione. Inoltre i commenti devono NON aprire anche quando hovero il loro popup, non solo l'icona nuvoletta!"

**Description:**
1. **Icon quality**: Usare SVG HD invece dell'attuale low-res icon
2. **Hover behavior**: Tooltip non deve aprirsi quando si hovera il tooltip stesso (solo sull'icona)

**Fix:**
```typescript
// Prevent tooltip open on self-hover
tooltipElement.addEventListener('mouseenter', (e) => {
  e.stopPropagation();
  this.cancelHideTimer();
});

tooltipElement.addEventListener('mouseleave', () => {
  this.startHideTimer();
});
```

---

## Low Priority Features

### FEAT-010: Notification Caching

**Priority:** LOW
**Effort:** 2 hours
**TODO ref:** "anche le notifiche si possono cachare dai"

**Description:**
Coperto da FEAT-002 (Intelligent Caching System).

---

### FEAT-011: Astra Filter Behavior (Country & Type Always Active)

**Priority:** LOW
**Effort:** 1 hour
**TODO ref:** "country e type possono stare ciascuno sempre attivo, assieme ovviamente ai filtri sotto. non sono mutuali"

**Description:**
Permettere di selezionare contemporaneamente Country e Type filter senza esclusione mutua.

**Status:** ✅ FIXED - Standardized filter bar with flexbox layout allows all filters to be visible and accessible on the same line with a vertical separator.

**Current:** Radio button (solo uno selezionabile)
**Desired:** Checkbox (entrambi selezionabili)

---

### FEAT-012: Chrome Data Sharing Investigation

**Priority:** LOW
**Effort:** 1 hour
**TODO ref:** "c è scritto che i dati sono sharati da chrome. come? funziona davvero?"

**Description:**
Documentare e verificare il funzionamento di `chrome.storage.sync` per la sincronizzazione cross-device.

**Task:**
- Testare sync tra Chrome desktop/mobile
- Documentare limiti (100KB per item, 8KB per value)
- Aggiungere docs in ARCHITECTURE.md

---

### FEAT-013: Astra Dashboard Opening Animation

**Priority:** LOW
**Effort:** 1 hour
**TODO ref:** "l astra dashboard una piccola animazione d apertura per rendere il tutto più fluido?"

**Description:**
Aggiungere animazione CSS smooth per l'apertura della dashboard Astra.

**Status:** ✅ FIXED - Implemented bouncy pop-up entry and smooth fade-out exit transitions. Added sticky control bar for persistent navigation.

**Implementation:**
```css
.astra-dashboard {
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

---

### FEAT-014: Query Voti Validation

**Priority:** LOW
**Effort:** 2 hours
**TODO ref:** "ricontrollare le query coi voti delle persone nelle activity. mi sa che ci sono degli errori"

**Description:**
Audit completo delle query GraphQL per i voti nelle activity feed. Verificare che i dati ritornati siano corretti e completi.

**Task:**
- Review `ActivityService.ts` query
- Test con vari scoreFormat (POINT_10, POINT_100, etc.)
- Fix eventuali inconsistenze

---

## Feature Roadmap

### Phase 1 - Critical UX (Q2 2026)
- ✅ FEAT-001: Module Toggle System
- ✅ FEAT-002: Intelligent Caching
- ✅ FEAT-003: Page Navigation

**Effort:** ~18 ore

### Phase 2 - Social & Astra (Q3 2026)
- FEAT-005: Private Lists
- FEAT-006: Conditional Scoring
- FEAT-007: Calendar Social Rework
- FEAT-008: Social Avatars Expansion

**Effort:** ~16 ore

### Phase 3 - Polish & Refinements (Q4 2026)
- FEAT-004: Message Privacy
- FEAT-009: Comment Icon/Hover
- FEAT-011: Filter Behavior
- FEAT-013: Animations

**Effort:** ~6 ore

### Phase 4 - Audit & Cleanup (Q1 2027)
- FEAT-012: Chrome Sync Docs
- FEAT-014: Query Validation

**Effort:** ~3 ore

---

## Total Effort Summary

| Phase | Features | Effort |
|-------|----------|--------|
| Phase 1 (Critical) | 3 | 18h |
| Phase 2 (Social/Astra) | 4 | 16h |
| Phase 3 (Polish) | 4 | 6h |
| Phase 4 (Audit) | 2 | 3h |
| **TOTAL** | **14** | **43h** |
