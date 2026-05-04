# AniList Ultimate - Roadmap & TODO

**Last Updated:** 2026-05-03
**Current Status:** Phase 6 (UI/UX Refinement) 🟢

---

## 🏗️ P6 - UI/UX REFINEMENT (IN PROGRESS)

*Focus: Polishing the interface, fixing layout regressions, and improving transitions.*

### Astra Dashboard & Core UI

- [X] **Symmetry & Header Refactor** - Fixed closing "X" position, unified Pill buttons (Override/Finale), and removed redundant title badges.
- [X] **BUG-020: Resize Handler** - Ensure extension elements (Astra, Tooltips) don't break when resizing the window.
- [X] **Astra Navigation** - Implement macro-categories (Reading, Completed, All, etc.) as dropdowns or tabs instead of just tags.
- [X] **Sticky Search** - Make the search bar in Astra sticky so it stays visible during scroll.
- [X] **Closing Animation** - Add a smooth "outro" animation when closing the Astra dashboard.
- [X] **Icon Standardization** - Fixed inverted Import/Export icons (using vertical arrows) and switched to FA SVG/JS for CSP safety.
- [X] **Seasonal Link** - Added "Seasonal" link to Browse dropdown with layout stabilization.

### Social & Activity Feed

- [X] **Pixel-Perfect Activity Feed** - Fully restored alignment, background colors, and interaction icons to match native AniList aesthetic.
- [X] **Gap Fix** - Eliminated the large empty space when resetting from custom list to default feed.
- [X] **Interaction Cleanup** - Hidden zero-count replies/likes and updated icon colors to native "azzurrino".
- [X] **Custom List Checkbox** - Replaced font-based "tofu" checkmark with pure CSS version for 100% reliability.
- [X] **Banner Action** - Add a "+" button near the "Follow" button in user banners for custom lists management.
- [ ] **Activity Score Restoration** - Ensure Astra scores appear in manually rendered custom activity entries (Line 124).

### Visual & Assets

- [X] **BUG-021: Comment Icon** - Replace low-res SVG and fix hover trigger area.
- [X] **BUG-025: Weight Position** - Move the Global Weight indicator to the left in Astra rows.
- [X] **COS-002: Calendar Redesign** - Reworked social activity graphics within calendar cards.

---

## 🛠️ P7 - DEBUG & ERRORS

- [X] **API Resilience** - Ensure cached data (Reviews, Calendar) is shown if API is down.
- [ ] **Astra Bug Hunt** - Systematic testing of internal Astra logic.
- [ ] **Astra Settings Fixes** - Fix slider overflow (Line 110) and drag-and-drop handles (Line 111).

---

## ✨ P8 - NEW FEATURES & INTEGRATIONS

- [X] **Media Metadata** - Add MAL score/link and Subreddit link to media pages.
- [ ] **Music Integration** - Show Opening/Ending titles with direct YouTube search links.
- [X] **Progress Notes & Auto-Save** - Full auto-save on close/tab-switch for Astra Rating & Journal.
- [X] **Cross-Module Sync** - Astra actions update Calendar and Dashboard in real-time.
- [ ] **Bulk Editor** - Create a tool for bulk editing items within custom lists in Astra Dashboard.
- [ ] l hover sull immagine dentro astra funzioni bene solo nella dashboard, nel quickedit è sfocata
- [ ] il journal funziona correttamente per gli anime, ma per i manga e le novel? non credo
- [ ] C è da finire i testi nei messaggi delle notifihce "mentioned you", "activity reply" ecc
- [ ] abilitare la ricerca dei voti nelle activity dentro la home dei profili utente, e se non c è anche nelle pagine social delle singole opere
- [X] nelle pagine dei characters continua a spamamre chiamate API, deve farne ZERO https://anilist.co/character/89/Shinji-Ikari
- [X] UI Cleanup: rimosso tab Astra duplicato dal profilo utente (mantenuto solo nella global nav)
- [X] **Calendar Stability** - Fixed disappearance bug after Quick Rate save using Atomic Swap injection.
- [X] **Astra Two-Way Sync** - Implemented report parser to read scores/journal from AniList notes back into Astra.
- [X] **Astra Report Refinement** - Cleaned up report aesthetics, removed technical tags, and added sub-section breakdown.
- [X] **Astra Quick-Save** - Added sidebar save button for Journal mode with consistent styling and feedback.
- [X] **Rating Reorder** - Standardized default sections order (Sound after Visuals).

---

## 🧹 P9 - STABILITY & REFACTORING

- [X] **Social Activity Stabilization** - Restricted social bubbles to home page and ensured cleanup.
- [X] **Home Page Social Bubbles** - Implemented calendar-style floating portals.
- [X] **Brand Cleanup** - Removed legacy "v2" CSS classes and updated logs.
- [X] **Status Enums** - Centralized TypeScript Enum for status management.
- [ ] **Review Caching** - Verify if the main `/reviews` page needs caching logic.
- [X] **Astra Note Append** - Combined Astra general notes, episode notes, and rating breakdown into a unified AniList comment.
- [ ] astra dashboard: wrapped da finire, ho scaricato le cose fatte con opus per avere lo sfondo fluidop, da integrare nel progetto
- [ ] astra dashbard: major rework da fare alle stats, pensare come
- [ ] astra dashboard: le freccette degli slider sono sempre attiva, anche quando i rispettivi slider non ci sono
- [X] **Follower Stats** - Add follower/following counters to relevant profile sections.
- [X] ricontrollar le chiamte API, a quanto pare qualcosa le gestisce male da qualche parte e hitta il limite a caso
- [X] Nelle actions dentro l astra dashboard, mettere anche il commento di anilist
- [ ] c è da implementare anche il soritng, tipo per completed date, data di modifica, start ecc
- [ ] Quando nel quick edit modifico il progresso, e non tramite il bottone +_, in anime e manga in progress, il counter originale di anilist non si agigorna, devo refreshare la agina per farlofunzionare. Accorciare!
---

## ✅ ARCHIVE (COMPLETED)

<details>
<summary><b>Click to view completed Milestones (P1 - P5)</b></summary>

### P5 - Data Consistency & Astra Stability

- ✅ **BUG-008**: Calendar social avatars always show.
- ✅ **BUG-009**: Astra dashboard initialization race condition fix.
- ✅ **BUG-031**: Works index map sync.
- ✅ **ARCH-003**: Vue.js Router interference prevention.

### P4 - Type Safety

- ✅ **BUG-014/16/17**: Removed `any` from core modules.
- ✅ **API Transparency**: Detailed GQL error extraction.

### P3 - Performance

- ✅ **BUG-007**: SharedGlobalObserver implementation.
- ✅ **BUG-010**: Local Font Awesome bundle.

</details>
