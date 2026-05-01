# OAuth Setup - Istruzioni per il Test

## 🔧 Setup Iniziale

### 1. Ricarica l'estensione in Chrome

1. Apri `chrome://extensions/`
2. Trova "Anilist Ultimate"
3. Clicca sul pulsante **Ricarica** (🔄)

### 2. Trova il Redirect URI Automatico

1. In `chrome://extensions/`, clicca su **"Service Worker"** sotto "Anilist Ultimate"
2. Si aprirà la DevTools del service worker
3. Nella console vedrai un messaggio come questo:

```
================================================================================
ANILIST OAUTH CONFIGURATION
================================================================================
Per configurare OAuth su AniList:
1. Vai a: https://anilist.co/settings/developer
2. Modifica l'app con Client ID: 17661
3. Aggiungi questo Redirect URI:

   https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.chromiumapp.org/

4. Salva le modifiche
================================================================================
```

4. **COPIA** l'URL che inizia con `https://...chromiumapp.org/`

### 3. Configura OAuth su AniList

1. Vai su https://anilist.co/settings/developer
2. Trova l'app con Client ID **17661**
3. Clicca **"Edit"**
4. Nel campo **"Redirect URI"**, incolla l'URL copiato prima
5. Clicca **"Save"**

## ✅ Test del Flusso OAuth

### Test 1: Login dal Popup

1. Clicca sull'icona dell'estensione nella toolbar
2. Clicca sul bottone **"Login with AniList"**
3. Dovrebbe aprirsi una finestra OAuth di AniList
4. Autorizza l'app
5. La finestra si chiuderà automaticamente
6. Il popup dovrebbe mostrare il tuo username

### Test 2: Login dal Calendario

1. Vai su https://anilist.co/home
2. Se non sei autenticato, vedrai il messaggio "Authentication Required"
3. Clicca sul bottone **"Log In"**
4. Segui il flusso OAuth
5. La pagina si ricaricherà e il calendario dovrebbe caricare i tuoi dati

### Test 3: Settings e Astra Dashboard

1. Con il login effettuato, clicca sull'icona ⚙️ nel calendario
2. Il pannello settings dovrebbe aprirsi
3. Vai su una pagina profilo utente (es. `/user/tuousername`)
4. Clicca sul tab **"Astra"** (se presente)
5. La dashboard Astra dovrebbe aprirsi

## 🐛 Debug - Se Qualcosa Non Funziona

### Controlla i Log

1. **Service Worker Log**: `chrome://extensions` → Service Worker
2. **Content Script Log**: F12 sulla pagina Anilist → Console
3. **Popup Log**: Click destro sull'icona → Ispeziona popup → Console

### Problemi Comuni

**Problema**: Il bottone Login non fa nulla
- **Soluzione**: Controlla la console per errori
- Verifica che il service worker sia attivo (`chrome://extensions`)
- Prova a ricaricare l'estensione

**Problema**: Errore "Invalid redirect_uri"
- **Soluzione**: Verifica che il redirect URI su AniList corrisponda ESATTAMENTE a quello stampato dal service worker
- Assicurati di aver salvato le modifiche su AniList

**Problema**: Settings/Astra non si aprono
- **Soluzione**: Controlla la console per errori JavaScript
- Verifica che il login sia stato completato con successo
- Ricarica la pagina

## 📝 Note per lo Sviluppo

- I log sono temporaneamente ATTIVI per il debug
- Ricorda di disabilitarli in produzione modificando `vite.config.ts`
- Il redirect URI è generato automaticamente da Chrome e cambia se l'extension ID cambia

## 🔄 Ripristino Versione Precedente

Se questa versione non funziona e vuoi tornare alla precedente:

```bash
cd anilist-ultimate-v2
git stash  # Salva le modifiche correnti
git checkout HEAD~1  # Torna alla versione precedente
npm run build
```
