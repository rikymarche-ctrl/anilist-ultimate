# Activity Filter Types - Documentazione Enum-Based System

## Panoramica

A partire dalla versione 2.0, il sistema di filtri delle attività usa valori enum-based invece di stringhe loose per garantire type safety e consistency.

## ActivityFilterType

```typescript
export type ActivityFilterType =
  | MediaListStatus.WATCHING   // "Watched" filter (anime progress)
  | MediaListStatus.READING    // "Read" filter (manga progress)
  | MediaListStatus.COMPLETED  // "Completed" filter
  | MediaListStatus.PLANNING   // "Plans" filter
  | MediaListStatus.DROPPED    // "Dropped" filter
  | MediaListStatus.PAUSED     // "Paused" filter
  | 'TEXT'                     // Text posts (non-media activities)
  | 'ALL';                     // Show all activities
```

## Mappatura Valori

### Prima (v1.x - Stringhe Loose)
```typescript
'watched'   → Filtro "Watched"
'read'      → Filtro "Read"
'completed' → Filtro "Completed"
'plans'     → Filtro "Plans"
'dropped'   → Filtro "Dropped"
'paused'    → Filtro "Paused"
'text'      → Post testuali
'all'       → Mostra tutto
```

### Dopo (v2.0 - Enum-Based)
```typescript
MediaListStatus.WATCHING   → Filtro "Watched"
MediaListStatus.READING    → Filtro "Read"
MediaListStatus.COMPLETED  → Filtro "Completed"
MediaListStatus.PLANNING   → Filtro "Plans"
MediaListStatus.DROPPED    → Filtro "Dropped"
MediaListStatus.PAUSED     → Filtro "Paused"
'TEXT'                     → Post testuali
'ALL'                      → Mostra tutto
```

## File Modificati

### Core
- **src/modules/activity/ActivityUtils.ts**
  - Aggiunto import di `MediaListStatus`
  - Creato tipo `ActivityFilterType`
  - Aggiunto alias `ActivityType` per backward compatibility
  - Aggiornato `getActivityType()` per ritornare valori enum

### UI Components
- **src/modules/activity/shared/ActivityFilterBar.ts**
  - Sostituito `ActivityType` con `ActivityFilterType`
  - Aggiornati tutti i valori dei filtri da lowercase a enum
  - Constructor: da `'all'` a `'ALL'`, da `'watched'` a `MediaListStatus.WATCHING`, ecc.
  - `getStandardFilters()`: tutti i valori aggiornati
  - `reset()`: da `'all'` a `'ALL'`

- **src/modules/activity/shared/ActivityRenderer.ts**
  - Sostituito `ActivityType` con `ActivityFilterType`
  - `applyFilters()`: da `has('all')` a `has('ALL')`

### Modules
- **src/modules/activity/ActivityEnhancerModule.ts**
  - Sostituito `ActivityType` con `ActivityFilterType` in `savedFilterState`

## Vantaggi

1. **Type Safety**: TypeScript previene errori di battitura e valori non validi
2. **Consistency**: Uso coerente dell'enum `MediaListStatus` in tutta la codebase
3. **Autocomplete**: IDE fornisce suggerimenti automatici per i valori enum
4. **Refactoring**: Modifiche ai valori enum si propagano automaticamente
5. **Enterprise-Level**: Standard professionale per codebase di grandi dimensioni

## Migrazione da v1.x a v2.0

### Codice Deprecato (ma funzionante)
```typescript
import type { ActivityType } from './ActivityUtils';

const filters: Set<ActivityType> = new Set(['all', 'watched']);
```

### Codice Nuovo (raccomandato)
```typescript
import { MediaListStatus } from '@/api/AnilistTypes';
import type { ActivityFilterType } from './ActivityUtils';

const filters: Set<ActivityFilterType> = new Set(['ALL', MediaListStatus.WATCHING]);
```

## Note Importanti

### Stringhe Rimanenti Legittime

Le seguenti stringhe lowercase sono **intenzionali** e non devono essere convertite:

1. **Parsing del testo** (`ActivityUtils.ts`):
   ```typescript
   if (lower.includes('watched') || lower.includes('watch'))
   ```
   Queste sono necessarie per rilevare il tipo di attività dal testo.

2. **Parametri funzione** (`ActivityFilterBar.getStandardFilters()`):
   ```typescript
   type: 'anime' | 'manga' | 'all'
   ```
   Questo parametro specifica quale tipo di media mostrare, non è un `ActivityFilterType`.

3. **Rendering HTML** (`ActivityRenderer.ts`):
   ```typescript
   const actType = activity.status?.toLowerCase() || 'watched';
   ```
   Stringhe usate solo per display, non per logica.

## Testing

Dopo la migrazione, verificare:

1. ✅ Compilazione TypeScript senza errori
2. ✅ Filtri UI funzionano correttamente
3. ✅ Salvataggio/ripristino stato filtri dopo navigazione
4. ✅ Custom list tab switching
5. ✅ Search query funziona con filtri

## Build Verification

```bash
npm run build
# ✅ Build successful (verified 2026-04-29)
```

---

**Autore**: ExAstra
**Data**: 2026-04-29
**Versione**: 2.0.0
