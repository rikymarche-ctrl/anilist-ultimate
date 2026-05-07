# 🚀 Astra Ultimate - Project Roadmap & TODO

---

## ✅ Enterprise Refactoring (COMPLETED)

- [X] **Atomic Storage & Lazy Loading**: Split monolithic JSON into manifest + media keys.
- [X] **Performance Optimization**: Fixed "Rerender Suicide" in AnimeCards and grid.
- [X] **API Decoupling**: Implemented `SyncQueueService` for background, non-blocking AniList sync.
- [X] **Infrastructure Cleanup**: Removed all "v2", "legacy", and migration debt.
- [X] **Smart Journal Sync**: Replaces existing Astra notes instead of appending duplicates.

---

## 📊 Astra Dashboard

*Il centro di controllo dell'esperienza Astra.*

- [X] **Infrastruttura Caching**: Sistema centralizzato O(1) completato.
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
- [ ] **Fix Astra Dashboard**: Risolvere il blocco totale della dashboard nato con l'apertura del nuovo branch (probabile conflitto DI o Storage).
- [ ] **Slider Arrows Bug**: Le freccette degli slider rimangono visibili anche senza contenuto.
- [ ] **QuickEdit Cleanup**: Risolvere immagine sfocata e bug del "doppio hover".
- [ ] **Modal UX**: Verificare che il tasto "Save" chiuda sempre la modale dopo aver accodato la richiesta.
- [ ] **Theme Adaptation**: Audit finale per compatibilità con i temi Dark/Contrast di AniList.
- [ ] **SharedGlobalObserver Audit**: Verificare l'impatto prestazionale dello scansionamento globale rispetto a MutationObservers mirati.

## 📈 Project Management

- [ ] **Setup Git Pubblico**: Configurare il repository ufficiale e archiviare i vecchi branch sperimentali.






manca il l animazione di outro

nel quick edit manca il tasto A girato per andare nella dashboard

muovere il toggle finale dentro il campo piuttosto che a destra di override

nel jounral i campi delle note fanno acnora il cazzo che vogliono

cambiare la X col comportamento default, se clicchi fuoris i chiude, autosave
