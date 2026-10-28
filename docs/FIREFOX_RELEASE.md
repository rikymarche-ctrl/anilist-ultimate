# Release Firefox (AMO) — nota operativa

Data: 2026-10-28 · Versione: 1.0.3 · Pacchetto: `release/anilist-ultimate-firefox-1.0.3.zip`

## Come si costruisce

```bash
npm run release           # entrambe le build, entrambi gli zip, lint Firefox
npm run build:firefox      # tsc + vite build --mode firefox → dist-firefox/
npm run package:firefox    # → release/anilist-ultimate-firefox-<versione>.zip
npm run lint:firefox       # web-ext lint su dist-firefox/
```

La build Chromium (`npm run build` / `npm run package`) non cambia: stesso manifest, stessa cartella `dist/`.
Il manifest Firefox viene generato in `vite.config.ts` (`firefoxManifest()`) partendo da `public/manifest.json`,
quindi c'è una sola fonte da mantenere.

## Incompatibilità trovate e cosa è stato cambiato

| # | Problema in Firefox | Gravità | Fix |
|---|---|---|---|
| 1 | Tutti i `src/styles/*.css` del manifest contengono `@import` verso file non copiati in build (`social-sidebar.css`, `base/components.css`). Chrome li ignora; Firefox annulla l'**intera** voce del content script, JS compreso: l'estensione non partiva affatto su anilist.co. | Bloccante | Nel manifest Firefox i CSS grezzi vengono rimossi. Tutte le loro regole sono già nei CSS bundle (`assets/main.css`, `assets/setup.css`), verificato selettore per selettore. |
| 2 | `chrome.storage.local.setAccessLevel` non esiste in Firefox: `initializeBackground()` andava in eccezione e il background non partiva. | Bloccante | `src/background.ts`: la chiamata avviene solo se la funzione esiste, altrimenti il barrier si risolve subito. |
| 3 | Le pagine dell'estensione in Firefox sono `moz-extension://<UUID per installazione>/`, e quell'host **non** è `runtime.id`. I controlli `chrome-extension://${runtime.id}` rifiutavano popup e impostazioni (recovery, sync recovery, notifiche storage). | Bloccante per popup/impostazioni | Nuovo `src/core/utils/ExtensionPage.ts` (`isExtensionPageUrl`, `isExtensionPageContext`) che usa `runtime.getURL()`. Usato in `BackgroundRouter`, `AuthStateClient`, `SyncQueueClient`. Test in `ExtensionPage.test.ts`. |
| 4 | Font Awesome chiama `window.requestAnimationFrame` senza `window` come receiver. Nei content script di Firefox questo lancia "does not implement interface Window" (decine di errori, icone non sostituite). | Alta | `src/core/ui/Icons.ts`: copia di `requestAnimationFrame` legata a `window`, visibile solo nel mondo isolato. |
| 5 | `storage.local.getBytesInUse` / `QUOTA_BYTES` non esistono in Firefox. | Bassa (solo statistica di utilizzo) | `LocalStorageBridge.localUsage()`: stima dalla dimensione serializzata. |
| 6 | Service worker MV3 non supportato: Firefox usa `background.scripts` (event page). | Bloccante | Manifest Firefox con `background.scripts` + `type: module` (crxjs `browser: 'firefox'`). Verificato: il background risponde ai messaggi. |
| 7 | Chiavi solo-Chromium: `key`, `minimum_chrome_version`, `options_page`. | Lint | Rimosse; `options_ui` con `open_in_tab`. |
| 8 | Mancavano `browser_specific_settings.gecko`. | Bloccante per AMO | `id: anilist-ultimate@exastra`, `strict_min_version: 140.0`, `data_collection_permissions: { required: ["none"] }`. |
| 9 | OAuth: il client AniList `35100` accetta solo il redirect `chromiumapp.org` (il login in Firefox finiva su una pagina `chromiumapp.org` irraggiungibile). | Bloccante per il login | Creato il client Firefox `55224` con il redirect `allizom.org`, configurato in `.env.firefox.local` (ignorato da git). `build:firefox` ora **fallisce** se usa il client Chromium; `AU_ALLOW_CHROMIUM_CLIENT=1` permette solo build locali di test. |

Controllati e già compatibili: `chrome.*` (Firefox MV3 lo espone con le Promise), `chrome.storage.session`
(usato solo nel background: `CalendarSessionCache`, `MusicVideoClient`), `runtime.sendMessage` dai content script,
content script `world: "MAIN"` (Firefox ≥128), import dinamico del loader crxjs, `identity.launchWebAuthFlow`,
CSP `extension_pages`, permessi e `host_permissions` (concessi all'installazione da Firefox ≥127, verificato).

### Differenza di sicurezza da conoscere

Senza `setAccessLevel`, in Firefox i content script **potrebbero** leggere direttamente `storage.local` (token incluso)
e ricevono `storage.onChanged` con i valori grezzi. Le pagine web non hanno accesso: il confine resta tra sito ed
estensione, non tra content script e background. Il codice continua comunque a passare dal bridge del background.

## Verifiche eseguite

- `tsc --noEmit`: pulito.
- `npx vitest run`: 195 file, 3352 test passati.
- `npm run build` e `npm run build:firefox`: entrambe ok; manifest Chromium invariato (service worker, `key`, 15 CSS).
- `web-ext lint`: **0 errori**, 0 notice, 23 warning (vedi sotto).
- Firefox 159 headless (Marionette, installazione temporanea, utente ospite):
  - permessi host concessi (`anilist.co`, `graphql.anilist.co`, ecc.);
  - background/event page risponde (`auth:status`), `storage.session` disponibile;
  - `identity.getRedirectURL()` = `https://38edd18e5a15a955d99ff3789eb7197b37e7eb97.extensions.allizom.org/`;
  - su `/home` e `/search/anime/this-season`: CSS e JS iniettati, tema, Astra navbar, pills e toast presenti;
  - `graphql.anilist.co` risponde 200 dall'origine `moz-extension://`.
  - Unico errore rimasto: 401 sulla query `Viewer` da ospite, uguale in Chromium.

### Warning di `web-ext lint` (non bloccanti, da spiegare ai revisori AMO)

- `UNSAFE_VAR_ASSIGNMENT` (21): assegnazioni a `innerHTML` nel codice bundle (template sanitizzati, icone SVG di Font Awesome).
- `DANGEROUS_EVAL` (2): fallback `Function("return this")` di `reflect-metadata`, irraggiungibile perché `globalThis` esiste.

## Da fare a mano prima di caricare su AMO

1. **Client OAuth Firefox**: fatto (ID `55224`, redirect
   `https://38edd18e5a15a955d99ff3789eb7197b37e7eb97.extensions.allizom.org/`). Su un'altra macchina va ricreato
   `.env.firefox.local` con `VITE_ANILIST_CLIENT_ID=55224`, altrimenti `build:firefox` si ferma.
2. **ID add-on**: `anilist-ultimate@exastra` diventa permanente al primo upload (decide redirect e storage). Cambiarlo ora se serve, in `vite.config.ts` (`FIREFOX_ADDON_ID`).
3. **Codice sorgente per AMO**: il bundle è minificato (terser), quindi AMO chiede lo zip dei sorgenti con le istruzioni
   (`npm ci && npm run build:firefox`, Node ≥22.13). Va generato dopo il commit, es. `git archive`.
4. **`data_collection_permissions`**: impostato a `none`. Va confermato rispetto a `PRIVACY.md`: token e query vanno ad
   AniList, gli ID degli anime a jikan.lucashdo.com / api.tenrai.org / toshy.github.io.
5. Il popup mostra "Updates: Chrome Web Store": da sostituire con il link AMO quando esiste.
6. `release/anilist-ultimate-1.0.3.zip` (Chrome) è stato **rigenerato** oggi dal working tree attuale, che include le
   modifiche non committate al calendario. Se serve lo zip identico a quello pubblicato, va rifatto dal tag/commit di release.

## Da verificare a mano in Firefox (con account reale)

- **Login OAuth**: login, annullamento e nuovo tentativo, logout durante il login, cambio account, secondo tab AniList,
  stato dopo il riavvio del background (in Firefox l'event page si sospende come il service worker).
- **Calendario**: primo caricamento con la corsia API prioritaria; ricarica pagina servita da `calendar:cache`
  (`storage.session`); invalidazione dopo una modifica in coda; cache svuotata alla chiusura del browser.
- **Sync**: modifica di voto/progresso/note, coda offline, allarme `sync_queue_process` (5 min), recovery dalla pagina impostazioni.
- **Popup e impostazioni**: si aprono in Firefox (`options_ui` in tab), backup/restore Astra, recovery.
- **Altro**: editor lista nativo (script `MAIN` world), Friend alerts (allarme), export immagine Wrapped (canvas + CORS),
  icone Font Awesome, font Inter/Outfit nei content script.
