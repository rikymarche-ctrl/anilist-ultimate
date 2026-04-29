# Anilist Ultimate - Documentation Index

Benvenuto nella documentazione tecnica di **Anilist Ultimate**. Questa cartella contiene tutta la documentazione di progetto, suddivisa per categoria.

---

## 📚 Quick Links

| Categoria | File | Descrizione |
|-----------|------|-------------|
| **User Docs** | [Main README](../README.md) | Overview progetto, installazione, features |
| **User Docs** | [CHANGELOG](../CHANGELOG.md) | Release history & version notes |
| **Architecture** | [ARCHITECTURE](ARCHITECTURE.md) | System design, patterns, DI structure |
| **Modules** | [MODULES](MODULES.md) | Descrizione dettagliata di ogni modulo |
| **Bugs** | [BUGS](BUGS.md) | Known bugs (38 totali) |
| **Security** | [SECURITY](SECURITY.md) | Security audit findings (18 issues) |
| **Performance** | [PERFORMANCE](PERFORMANCE.md) | Performance issues (7 problemi) |
| **Features** | [FEATURES](FEATURES.md) | Feature roadmap (14 items, 43h effort) |
| **TODO** | [TODO](TODO.md) | Current work, ideas, user feedback |
| **Testing** | [TESTING](TESTING.md) | Test procedures & QA checklist |

---

## 🏗️ Technical Documentation

### [ARCHITECTURE.md](ARCHITECTURE.md)
Architettura del sistema e pattern utilizzati:
- **DI Pattern** (tsyringe)
- **Event-driven** (EventBus)
- **State Management** (Store pattern)
- **Module System** (BaseModule)
- **Navigation** (SPA routing intercept)

**Target audience:** Developers che vogliono contribuire o capire il design

---

### [MODULES.md](MODULES.md)
Breakdown dettagliato dei 12 moduli:

1. **Calendar Module** - Enhanced calendar view
2. **Notification Cleaner** - Notification grouping & formatting
3. **Activity Enhancer** - Custom lists & filters
4. **Forum Module** - Forum enhancements
5. **Astra Module** - Advanced scoring system
6. **Reviews Module** - Review integration
7. **Social Module** - Friend activity tracking
8. **Hover Comments** - Quick comment tooltips
9. **Media Social Enhancer** - Social features on media pages
10. **Navigation Service** - SPA navigation intercept
11. **Config Manager** - Settings persistence
12. **Error Handler** - Global error handling

**Target audience:** Developers che vogliono estendere/modificare i moduli

---

## 🐛 Issue Tracking

### [BUGS.md](BUGS.md)
**38 bug totali** categorizzati per severity:

| Severity | Count | Key Issues |
|----------|-------|------------|
| Critical | 3 | ~~Dual token~~ (fixed), GraphQL injection |
| High | 11 | Memory leak, cache corruption, API spam |
| Medium | 11 | Type safety, config issues |
| Low | 8 | UI/UX polish |
| Cosmetic | 5 | Visual refinements |

**Status:**
- ✅ P0 Blockers: **FIXED** (BUG-001, BUG-002)
- ⚠️ P1 Critical: 4 aperti (BUG-029, BUG-033, BUG-028, BUG-030)

**Target audience:** QA, developers, project managers

---

### [SECURITY.md](SECURITY.md)
**18 security findings** da audit code review:

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 4 | 3 fixed, 1 open (SEC-018) |
| High | 4 | 2 fixed, 2 open |
| Medium | 6 | All open |
| Low | 4 | All open |

**Key issues:**
- ✅ XSS via innerHTML (FIXED)
- ✅ Dual token management (FIXED)
- ⚠️ GraphQL injection in SocialService (OPEN)
- ⚠️ Font Awesome CDN (supply chain risk)

**Target audience:** Security auditors, lead developers

---

### [PERFORMANCE.md](PERFORMANCE.md)
**7 performance issues** identificati:

| Severity | Issue | Impact |
|----------|-------|--------|
| Critical | getAllFollowings() - 40+ API calls | Rate-limit, timeout 60s |
| Critical | activityCache memory leak | Tab crash dopo 2h |
| High | 4x MutationObserver su body | CPU 25% |
| High | Polling 3s interval | Battery drain |

**Metriche:**
- Baseline: 80MB RAM
- Dopo 2h browsing: **Tab crash** (out of memory)
- CPU idle: 18-25% (vs 2-3% nativo)

**Target audience:** Performance engineers, developers

---

## 🚀 Development & Planning

### [FEATURES.md](FEATURES.md)
**14 feature requests** da TODO e user feedback:

**Roadmap:**
- **Phase 1** (Q2 2026): Module toggle, caching, navigation - 18h
- **Phase 2** (Q3 2026): Social features, Astra enhancements - 16h
- **Phase 3** (Q4 2026): Polish, animations, UI - 6h
- **Phase 4** (Q1 2027): Audit, cleanup - 3h

**Total effort:** 43 ore

**Target audience:** Product managers, developers

---

### [TODO.md](TODO.md)
Lista di lavoro corrente, idee raw, user feedback non ancora classificato.

**Contiene:**
- Note sparse su problemi riscontrati
- Idee per nuove features
- UX improvements
- Link a issue/screenshot

**Target audience:** Developers, lead

---

### [TESTING.md](TESTING.md)
Procedure di test, checklist QA, scenari di regressione.

**Contiene:**
- Manual test procedures
- Regression test cases
- Edge cases
- Browser compatibility matrix

**Target audience:** QA engineers, testers

---

## 📊 Documentation Stats

| Metric | Value |
|--------|-------|
| **Total bugs tracked** | 38 |
| **Security findings** | 18 |
| **Performance issues** | 7 |
| **Feature requests** | 14 |
| **Modules documented** | 12 |
| **Total doc pages** | 10 |
| **Lines of documentation** | ~3000 |

---

## 🔗 External Resources

- **Main README**: [../README.md](../README.md)
- **GitHub Issues**: (link to repo issues)
- **Chrome Web Store**: (link quando pubblicato)
- **AniList API Docs**: https://anilist.gitbook.io/anilist-apiv2-docs/

---

## 🤝 Contributing

Se vuoi contribuire:
1. Leggi [ARCHITECTURE.md](ARCHITECTURE.md) per capire il design
2. Controlla [BUGS.md](BUGS.md) per issue aperti
3. Consulta [TESTING.md](TESTING.md) per le procedure di test
4. Proponi nuove features via [FEATURES.md](FEATURES.md)

---

**Last Updated:** 2026-04-27
**Maintained by:** ExAstra / rikymarche-ctrl
