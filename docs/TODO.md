# Astra Ultimate V2 - TODO List

## 🚀 High Priority (Current Phase)
- [ ] **Virtual Scrolling**: Implement true windowed rendering for the Dashboard WorkTable to eliminate lag with 1000+ entries.
- [ ] **Deep Integration Testing**: Validate the full sync loop (AniList -> Astra -> Local -> AniList) with edge cases (deleted entries, network failures).
- [ ] **Final UI Polish**: Audit all tooltips, hover states, and micro-animations for consistent premium feel.

## ✨ Planned Features
- [ ] **Astra Stats v2**: Detailed visualization of scoring trends, genre distribution, and rating history.
- [ ] **Multi-Format Support**: Verify full compatibility of Journal for Manga (Chapters) and Novel (Volumes).
- [ ] **Optional Comments**: Settings toggle to disable automatic sync of Astra summaries to AniList comments.
- [ ] **Special Awards**: System to assign custom "accolades" or awards to exceptional works.

## 🛠️ Fixes & UX Improvements
- [x] Fix Dashboard navigation listener "freeze" after tab switch.
- [x] Refactor Modal/Dashboard to use shared `AstraOverlayService`.
- [x] Implement "Premium Lighting" focus effect.
- [ ] Improve search debounce logic for ultra-large lists.
- [ ] Add "Export to JSON" for manual data backups.

## 🏗️ Architecture & Technical Debt
- [x] Decompose `AstraWorkTable` into atomic renderers.
- [x] Centralize modal state in `AstraRatingStore`.
- [ ] Add unit tests for `AstraParserService` merge logic.
- [ ] Implement robust error boundary for Astra UI injection.
