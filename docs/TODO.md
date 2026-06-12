# 🚀 Astra Ultimate - Project Roadmap & TODO

---

## ✅ Enterprise Refactoring (COMPLETED)

- [X] **Atomic Storage & Lazy Loading**: Split monolithic JSON into manifest + media keys.
- [X] **Performance Optimization**: Fixed "Rerender Suicide" in AnimeCards and grid.
- [X] **API Decoupling**: Implemented `SyncQueueService` for background, non-blocking AniList sync.
- [X] **Infrastructure Cleanup**: Removed all "v2", "legacy", and migration debt.
- [X] **Smart Journal Sync**: Replaces existing Astra notes instead of appending duplicates.

---

## 🏗️ Debito Architetturale (Code Review 2026-06-12)

### ✅ Risolti in questa review
- [X] **Sicurezza**: GraphQL injection (GraphQLBatcher `$`-passthrough + HoverComments), XSS (AstraRadarChart nomi sezione, CustomListManager search), `clearQueue` promise appese, race cold-start MV3 (background.ts), `factoryReset` scan storage rotto.
- [X] **SyncQueueService race**: mutex async (`withLock`) serializza enqueue/process nel contesto.
- [X] **Performance**: sync AniList O(n²)→O(n) (`skipPersist` + persist unico).
- [X] **Memory leak**: listener `document` gestiti in AstraStatusSelector/AstraScoreForm.
- [X] **Dead code**: rimossi CustomScrollbar, AstraWorkGrid, AstraStatsOverview.
- [X] **Immutabilità**: `AstraRepository.getSections/getSettings` ritornano copie.
- [X] **Style**: `console.log`→`log.debug` (AstraUIBridge, AstraNavigationService, AstraEnhancementService).
- [X] **DI duplicata**: rimossa doppia registrazione Astra in `setup.ts`.

### 🔴 Da fare — refactor strutturali (richiedono test prima)
- [~] **Test coverage (PRIORITÀ 0)** — fondazione core posata (12 file, 84 test verdi): Store, GraphQLBatcher, SyncQueueService, AstraRepository, AnilistClient, LRUCacheWithTTL, AstraCalculator, AstraFilterService (rilocato), Sanitizer, EventBus, NavigationService, CalendarDataService. **Mancano**: moduli UI/feature (calendar/social/activity renderers), AstraParserService, AstraSyncService end-to-end. Target 80%.
  - Rimosso dead code Sanitizer (sanitize/formatMultiline); bug reale trovato+fixato in EventBus (throw sincrono dei listener).
- [ ] **Service-locator → Constructor Injection**: eliminare i `container.resolve()` a runtime (AstraSyncService EventBus, AnimeCard getter CalendarService/SocialRenderer, AstraModule.resolveDependencies, AstraJournalService). Anti-pattern che nasconde le dipendenze.
- [ ] **Unificare i 3 pattern di store**: `core/state/Store`, `AstraDashboardStore`, `CalendarStore` non condividono astrazione. Estrarre una base reattiva comune.
- [ ] **`AstraService` god-facade**: ~30 metodi pass-through verso il repository. Far dipendere i consumer direttamente dal repository o splittare per dominio.
- [ ] **Consolidare push-to-notes**: logica duplicata tra `AstraSyncManager.push` e `AstraRatingService.saveAndSync` (rischio drift). Un solo proprietario.
- [ ] **Dipendenze circolari**: rimuovere i workaround `delay()` / `resolveDependencies` lazy ridisegnando i confini dei moduli.
- [ ] **`IConfigManager` duplicata**: definita due volte (core/interfaces + inline). Tenerne una.
- [ ] **SyncQueue cross-context**: la coda è condivisa tra service worker e content script (stesso storage key, 2 container). Far gestire le scritture a un solo proprietario via messaging.
- [ ] **`destroy()` incompleti** sui singleton (ThemeManager/CommentTooltip/SocialSidebar/AstraUIBridge/CustomListModule): non rimuovono i listener globali (non accumulano perché 1×/pagina, ma da sistemare per pulizia).

### 🟢 Minori
- [ ] `settings.ts:231`: `error.message` in `innerHTML` senza escape (schermata di errore).
- [ ] `ActivityRenderer`: URL avatar/cover interpolati non-escaped in `url()` CSS (basso rischio, URL CDN AniList).
- [ ] `AnilistClient`: heuristic `data !== undefined` per raw/non-raw → usare il flag `isRaw` come unica fonte.

---

## 📊 Astra Dashboard

*Il centro di controllo dell'esperienza Astra.*

- [X] **Infrastruttura Caching**: Sistema centralizzato O(1) completato.
- [ ] **Virtual Scrolling**: Implementare il rendering a finestre (Windowing) per eliminare il lag della Dashboard con 1000+ entry.
- [ ] **Sorting Avanzato**: Implementare nel `AstraFilterService` il sorting reale per `Completed Date`, `Data di modifica`, `Start`, ecc. (Logica pronta, serve UI binding).
- [ ] **Astra Wrapped**: Integrare lo sfondo fluido (Opus) per il recap stagionale.
- [ ] **Dynamic UI (Scrolling)**: Header collassabile durante lo scroll della grid per massimizzare lo spazio.
- [ ] **Bulk Editor**: Strumento per editing massivo di tag e liste personalizzate.

## 📓 Astra Ratings & Journal

*Sistema di annotazione e valutazione avanzata.*

- [ ] **Multi-Format Support**: Verificare piena compatibilità del Journal per Manga (Chapters) e Novel (Volumes).
- [ ] **Optional Comments**: Opzione nelle impostazioni per disabilitare il sync automatico dei commenti su AniList.
- [ ] **Sistema Lodi**: Implementare un sistema per assegnare "lodi" o premi speciali a opere eccezionali.

## 🛠️ Fixes & UX Improvements

- [ ] **Riprogettazione Flussi Iniezione**: Studiare tutte le combinazioni (Calendar ON/OFF, Astra ON/OFF) per decidere il comportamento ideale della Pillola/Capsula in ogni scenario (Home, Liste, Calendar).
- [ ] **Fix Astra Dashboard**: Risolvere il blocco totale della dashboard (probabile conflitto DI o Storage).
- [ ] **Slider Arrows Bug**: Le freccette degli slider rimangono visibili anche senza contenuto.
- [ ] **QuickEdit Cleanup**: Risolvere immagine sfocata e bug del "doppio hover".
- [ ] **Modal UX**: Verificare che il tasto "Save" chiuda sempre la modale dopo aver accodato la richiesta.
- [ ] **Theme Adaptation**: Audit finale per compatibilità con i temi Dark/Contrast di AniList.
- [ ] **SharedGlobalObserver Audit**: Verificare l'impatto prestazionale dello scansionamento globale rispetto a MutationObservers mirati.

## 📈 Project Management

- [ ] **Setup Git Pubblico**: Configurare il repository ufficiale e archiviare i vecchi branch sperimentali.

manca il l animazione di outro

nel quick edit manca il tasto A girato per andare nella dashboard [FATTO]

muovere il toggle finale dentro il campo piuttosto che a destra di override

nel jounral i campi delle note fanno acnora il cazzo che vogliono

cambiare la X col comportamento default, se clicchi fuoris i chiude, autosave [FATTO]


![1778274459709](image/TODO/1778274459709.png)

non diventa rossa e il counter non riparte, per farlo bisogna refreshare la pagina

rimuovere nella apgina degli anime la parte di query sui following, fare in modo che le cusotm lists funzionino anche qua, stessa cosa per i voti, e sistemare i commenti che sono completmante fuckuppati

sempre qua, se cliccho sul bottone sotto la cover, non c è lo stile personalizzato come era prima, ma apre comunque la finestra corretta (CHE PERÒ NON SI CHIUDE SE CLICCO FUORI!). quindi andare a cercare per eventuale codice morto


quando ho cliccato nella pagina di un personaggio: 
Error in Anilist API
Not Found.
Perchè l ha fatto? Quelle apgine devono essere escluse da ogni tipo di chiamata