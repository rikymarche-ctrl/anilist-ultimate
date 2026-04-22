# AniList Ultimate v2 - Project Roadmap & TODO

## ✅ Completed Features

- **[Calendar Module]** Full rework with Grid/List modes, release countdowns, and real-time settings.
- **[Social Sidebar]** Premium glassmorphic restyling, server-side status filtering, and local friend search.
- **[Social Popups]** Floating bubbles on cards with friend avatars and profile deep linking.
- **[Notification Cleaner]** Search functionality and visual grouping of notifications.
- **[Activity Score]** Integrated review-style score badges into activities.
- **[Global Settings]** Reactive settings panel for all modules.

## 🛠️ In Progress / Stabilization

- [ ] **Hover Comments Stabilization**: Fix layout regressions and performance during rapid scrolling.
- [ ] **Code Cleanup**: Remove legacy experimental JS timers and unused CSS classes.

## 📈 Activity Feed & Social Enhancements

- [ ] **Reply Text Fix**: In activities marked as "replied", show `replied to "Original Text (max 100 chars)" with "Reply Text"` instead of just the original post content.
- [ ] **Custom OAuth Client ID**: Set up a dedicated AniList OAuth application and update `OAUTH_CONFIG` to remove the public placeholder.
- [ ] **Custom List Integration**: Finalize filtering modules and FIX rendering/cloning logic for custom activities to ensure 100% native fidelity.
- [ ] **Caching System**: Implement a robust caching layer for API responses (Reviews, Scores, Activity Data) to prevent rate limiting and improve performance.
- [ ] **Activity Score Module**: Improve handling of private profiles and missing media to avoid 'Not Found' API errors.

quando in un activity seleziono tipo uina lsita e cambio pagina, BISOGNA FARE IL REFRESH DEI FILTIR, altrimenti si bugga.

ricontrollare le uery coi voti delle persone nelle activity. mi sa che ci sono degli errori

ero fermo con una custom list  nell activity, ma penso anilist abbia mandato un refresh, la classica per aggiornare la pagina con le nuove interazioni, ma è tornato automaticamente su global. Bisogna gestirle!


i Colori di anilist differeiscono da quellis celtio, il viola ecc


---

*Last Updated: 2026-04-23*
