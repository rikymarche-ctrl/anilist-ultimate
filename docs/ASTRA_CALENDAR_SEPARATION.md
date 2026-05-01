# Separazione Astra e Calendar - Architettura

**Data**: 2026-05-02
**Autore**: ExAstra / rikymarche-ctrl

## 📋 Panoramica

Questo documento descrive come Astra e Calendar convivono nel sistema in modo **completamente disaccoppiato**, con responsabilità chiare e separate.

---

## 🎯 Principi di Design

### 1. **Indipendenza Totale**
- Astra e Calendar sono **moduli indipendenti**
- Uno può funzionare senza l'altro
- Nessuna dipendenza diretta nel codice (solo detection DOM)

### 2. **Separation of Concerns**
- Ogni funzionalità ha UNA sola responsabilità
- Nessuna logica mista o condizioni ambigue
- Logging chiaro per debugging

### 3. **Robustezza**
- Selettori multipli con fallback
- Polling + Observer per React SPA
- Gestione graceful dei casi edge

---

## 🔧 Componenti Astra

### 1️⃣ **Pulsante Navbar Globale** (`injectGlobalDashboardButton`)

**Responsabilità**: Iniettare il link "Astra" nella barra di navigazione principale di AniList.

**Condizioni**: **SEMPRE** presente, **OVUNQUE**.

**Strategia di Iniezione**:
```typescript
// Strategy 1: Selettori diretti
.nav .links
.header .links
.nav-wrap .links

// Strategy 2: Via link esistenti (più robusto)
a[href^="/browse"]
a[href="/social"]

// Strategy 3: Qualsiasi link in nav/header
.nav a.link
.header a.link
```

**Meccanismo**:
- ✅ Tentativo immediato all'init
- ✅ Polling per 10 secondi (40 tentativi x 250ms)
- ✅ Observer permanente per re-render React

**Logging**:
- `[Astra] Injecting global navbar button` → Successo
- `[Astra] Navbar links container not found yet` → Tentativo fallito (riprova)
- `[Astra] Global navbar button injection failed after 10 seconds` → Fallimento definitivo

**Dipendenze**: NESSUNA (non dipende dal Calendar)

---

### 2️⃣ **Pulsante Home Fallback** (`setupHomeFallback`)

**Responsabilità**: Fornire accesso rapido ad Astra dalla home page quando il Calendar non è attivo.

**Condizioni**:
- ✅ Solo sulla **Home Page** (`/` o `/home`)
- ✅ Solo se **Calendar NON è presente** (`#anilist-calendar` non trovato)

**Comportamento**:
1. Se Calendar **NON c'è**: Inietta pulsante nell'header "Airing"
2. Se Calendar **appare**: Rimuove il pulsante fallback automaticamente
3. Se Calendar **scompare**: Re-inietta il pulsante

**Strategia**:
```typescript
// Trova header "Airing" nativo
h2, h3, .title, .section-header .title
  → text.includes('airing')

// Inietta pulsante in .actions o .header-actions
```

**Meccanismo**:
- ✅ Observer permanente per cambiamenti DOM
- ✅ Listener su `EVENT_TYPES.CALENDAR_LOADED` per reagire al caricamento Calendar
- ✅ Controllo su navigation event

**Logging**:
- `[Astra] Injecting home page fallback button (calendar not present)` → Iniezione
- `[Astra] Removing home fallback button (calendar is present)` → Rimozione automatica

**Dipendenze**: **DETECTION** Calendar (non dipendenza diretta)

---

### 3️⃣ **Pills sulle Cards** (`enhanceNativeCards`)

**Responsabilità**: Aggiungere pulsanti di azione rapida (rate, increment progress, social) sulle card dei media.

**Condizioni**:

| Pagina | Condizione | Logica |
|--------|-----------|--------|
| **Home** (`/`, `/home`) | Solo se Calendar È presente | Pills operano sulle card del Calendar custom |
| **User Lists** (`/animelist`, `/mangalist`) | **SEMPRE** | Indipendente dal Calendar |
| **Media Page** (`/anime/123`, `/manga/456`) | **SEMPRE** | Sidebar, indipendente dal Calendar |

**Strategia Home Page**:
```typescript
if (calendarPresent) {
  // Aggiungi pills alle sezioni "In Progress"
  // (skippa "Airing" e "Schedule" → gestite da Calendar)
} else {
  // Rimuovi pills dalle sezioni home (cleanup)
  // NON rimuove pills da user lists o media pages
}
```

**Meccanismo**:
- ✅ Observer permanente per nuove card
- ✅ Delegated event handling (window capture phase)
- ✅ Reactive update su preferenze social

**Logging**:
- `[Astra] Calendar present, adding pills to "In Progress" cards`
- `[Astra] Calendar not present, removing pills from home page`
- `[Astra] Enhancing user list cards`
- `[Astra] Enhancing N cards in "In Progress" section`

**Dipendenze**: **DETECTION** Calendar sulla home, indipendente altrove

---

## 📊 Matrice di Decisione

| Componente | Calendar Presente | Calendar Assente | Dipendenza |
|-----------|-------------------|------------------|-----------|
| **Navbar Button** | ✅ Sempre | ✅ Sempre | ❌ No |
| **Home Fallback** | ❌ Nascosto | ✅ Visibile | ⚠️ Detection |
| **Pills (Home)** | ✅ Visibile | ❌ Nascosto | ⚠️ Detection |
| **Pills (Lists)** | ✅ Sempre | ✅ Sempre | ❌ No |
| **Pills (Media Page)** | ✅ Sempre | ✅ Sempre | ❌ No |

---

## 🧪 Scenari di Test

### Scenario 1: Calendar Attivo
```
✅ Navbar: Pulsante "Astra" presente
❌ Home Fallback: Pulsante nascosto
✅ Home Pills: Pills visibili su "In Progress"
✅ List Pills: Pills visibili
✅ Media Pills: Pills visibili nella sidebar
```

### Scenario 2: Calendar Disattivato
```
✅ Navbar: Pulsante "Astra" presente
✅ Home Fallback: Pulsante visibile nell'header "Airing"
❌ Home Pills: Pills nascoste (nessuna card Calendar)
✅ List Pills: Pills visibili
✅ Media Pills: Pills visibili nella sidebar
```

### Scenario 3: Calendar Si Carica in Ritardo
```
1. Init: Home Fallback iniettato
2. Calendar appare: Home Fallback RIMOSSO automaticamente
3. Pills appaiono sulle card "In Progress"
```

### Scenario 4: React Re-Render Navbar
```
1. Pulsante navbar presente
2. React ridisegna navbar → pulsante scompare
3. Observer cattura mutazione
4. Pulsante navbar RE-INIETTATO automaticamente
```

---

## 🐛 Debugging

### Pulsante Navbar Non Appare

**Verifica**:
1. Apri Console Developer
2. Cerca log: `[Astra] Injecting global navbar button`
3. Se vedi `Navbar links container not found yet` ripetuto → problema selettori

**Ispezione DOM**:
```javascript
// In console
document.querySelector('.nav .links')
document.querySelector('a[href^="/browse"]')
```

**Fix**:
- Verifica struttura navbar di AniList (potrebbe essere cambiata)
- Aggiungi selettore alternativo in `injectGlobalDashboardButton()`

### Pills Non Appaiono sulla Home

**Verifica**:
1. Controlla se Calendar è presente: `!!document.querySelector('#anilist-calendar')`
2. Se `true` ma pills non ci sono → problema processamento card
3. Se `false` → comportamento corretto (pills visibili solo con Calendar)

**Ispezione**:
```javascript
// In console
document.querySelector('#anilist-calendar') // Deve esistere
document.querySelectorAll('.au-pill-wrapper') // Dovrebbe mostrare pills
```

### Home Fallback Non Appare

**Verifica**:
1. Sei sulla home? `window.location.pathname === '/'`
2. Calendar assente? `!document.querySelector('#anilist-calendar')`
3. Header "Airing" esiste? Cerca "Airing" nella pagina

**Ispezione**:
```javascript
// In console
Array.from(document.querySelectorAll('h2, h3')).find(h =>
  h.textContent.toLowerCase().includes('airing')
)
```

---

## 🔄 Event Flow

### Init Sequence
```
1. AstraModule.init()
   ├─ initProgressEnhancer() [setup observer pills]
   ├─ injectGlobalDashboardButton() [navbar + polling + observer]
   └─ setupHomeFallback() [home fallback + observer]
```

### Calendar Loaded Event
```
1. CalendarModule emits EVENT_TYPES.CALENDAR_LOADED
2. setupHomeFallback listener triggered
   └─ injectHomeFallback()
      └─ Calendar present → remove fallback button
```

### Page Navigation
```
1. NavigationService emits page change
2. enhanceNativeCards() called
   ├─ Home? → Check calendar, add/remove pills
   ├─ List? → Add pills sempre
   └─ Media? → Add sidebar pills sempre
```

---

## 📝 Miglioramenti Futuri

### Possibili Ottimizzazioni

1. **Cache Selettori**
   - Salvare riferimento a `.nav .links` dopo il primo successo
   - Evitare query ripetute

2. **Debounce Observer**
   - Observer callback potrebbe triggerare troppo spesso
   - Aggiungere debounce di 100-200ms

3. **Lazy Loading Pills**
   - Processare solo card visibili nel viewport
   - IntersectionObserver per performance

4. **CSS Injection**
   - Spostare stili inline in CSS classes
   - Più pulito e performante

---

## ✅ Checklist Implementazione

- [x] Separata iniezione navbar da home fallback
- [x] Migliorati selettori navbar (3 strategie)
- [x] Esteso polling a 10 secondi
- [x] Aggiunto logging dettagliato
- [x] Separata logica pills per pagina
- [x] Pills user list indipendenti da Calendar
- [x] Pills media page indipendenti da Calendar
- [x] Auto-rimozione fallback quando Calendar appare
- [x] Documentazione completa
- [x] Unregister corretto degli observer in destroy()

---

## 🎨 Estetica

### Colori Accent
- Navbar Button: `--astra-accent` (`#8b5cf6` - viola)
- Home Fallback: `--astra-accent` (`#8b5cf6` - viola)
- Consistenza visuale garantita

### Transizioni
- `transition: all 0.2s` su tutti i pulsanti
- Hover: `scale(1.1)` per feedback immediato
- Nessun glow o box-shadow problematico (risolto)

---

**Fine Documento**
