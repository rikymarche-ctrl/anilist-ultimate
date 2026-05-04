# 🚀 Astra Ultimate - Project Roadmap & TODO

---

## 📊 Astra Dashboard

*Il centro di controllo dell'esperienza Astra.*

- [X] **Infrastruttura Caching (Enterprise Refactor)**: Sistema centralizzato O(1) con persistenza trasparente completato.
- [ ] **Sorting & Filtering**: Implementare il sistema di ordinamento reale per la dashboard.
  - **Filtri da applicare**: `Title`, `Score (Astra)`, `Progress`, `Last Updated`, `Last Added`, `Start Date`, `Completed Date`.
  - *Nota*: Rimosse metriche esterne non rilevanti (Popularity, Release Date, Average Score) in quanto la dashboard è focalizzata sui dati personali Astra.
- [ ] **Sorting Avanzato**: Implementare il sorting anche per `Completed Date`, `Data di modifica`, `Start`, ecc.
- [ ] **Astra Wrapped**: Da finire. Integrare lo sfondo fluido scaricato (fatto con Opus) nel progetto.
- [ ] **Stats Major Rework**: Riprogettazione profonda delle statistiche (pensare a come strutturarle).
- [ ] **Dynamic UI (Scrolling)**: Fare in modo che quando si scrolla, la parte superiore (Sync, Toggle Progress, Fill, ecc.) sparisca, lasciando visibili solo i filtri per massimizzare lo spazio di lavoro.
- [ ] **Bulk Editor**: Creare uno strumento per il bulk editing degli elementi all'interno delle liste personalizzate della Astra Dashboard.

## 📓 Astra Ratings & Journal

*Sistema di annotazione e valutazione avanzata.*

- [ ] **Multi-Format Support**: Il Journal funziona correttamente per gli anime, ma va verificata e implementata la piena compatibilità per Manga e Novel.
- [ ] **Optional Comments**: Fare in modo che l'append del commento autogenerato sia opzionale.
- [ ] **Infinite Saving Bug**: Fixare il problema del "Save" che gira all'infinito nell'Astra Journal senza salvare.
- [ ] un sistema per dare le lodi?

## 👥 Social & Activity

*Integrazione con la community di AniList.*

- [ ] **Notification Texts**: Completare i testi nei messaggi delle notifiche come "mentioned you", "activity reply", ecc.

## 🛠️ Fixes & UX Improvements

*Rifinitura e stabilità dell'interfaccia.*

- [ ] **Slider Arrows**: Le freccette degli slider nella dashboard sono sempre attive, anche quando i rispettivi slider non sono presenti.
- [ ] **Image Hover/QuickEdit**: Risolvere il problema dell'immagine sfocata nel QuickEdit e il bug del "doppio hover" (compaiono 2 immagini).
- [ ] **Astra Settings Layout**: Lo slider nelle impostazioni spinge leggermente troppo sotto gli elementi circostanti.
- [ ] **Theme Adaptation**: Adattare tutti i componenti e le feature a tutti i temi disponibili.

## ⚙️ Core & Infrastructure

*Base tecnica e manutenzione.*

- [X] **Enterprise Cache Validation**: Verificata e ottimizzata tutta la logica di caching (ReviewService, Calendar, Social, Notifications, Activity).

## 📈 Project Management

- [ ] **Setup Git Pubblico**: Configurare il repository ufficiale su [GitHub](https://github.com/rikymarche-ctrl/anilist-ultimate) e procedere con la chiusura definitiva dei due vecchi repository (ci sarebbe da chiudere gli altri 2 vecchi).

---
