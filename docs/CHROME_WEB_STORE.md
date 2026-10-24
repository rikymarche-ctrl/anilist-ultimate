# Chrome Web Store — AniList Ultimate (Unofficial) BETA 1.0.3

Materiale aggiornato il 2026-10-21. I testi nei blocchi sono in inglese e pronti da incollare. Le istruzioni fuori dai blocchi sono per il manutentore. La bozza online non è stata modificata o inviata in revisione.

## 1. Pacchetto

Caricare `release/anilist-ultimate-1.0.3.zip` sulla **scheda esistente** con ID `gogibdaaglfefnemakliohebmcjfdddo`. Non creare un nuovo elemento. Il titolo e il riepilogo provengono dal manifest del nuovo ZIP: le schermate con il vecchio titolo, vecchia icona e soli permessi storage/identity non rappresentano la build attuale.

- Nome dal pacchetto: **AniList Ultimate (Unofficial) BETA**.
- Versione: **1.0.3**, successiva all'ultima versione pacchettizzata (1.0.2).
- Permessi attuali: `storage`, `identity`, `unlimitedStorage`, `alarms`, più i cinque host documentati sotto.
- Lo ZIP non contiene la chiave di sviluppo, le sorgenti, i file `.env`, le dipendenze di sviluppo o le source map. `dist/` resta disponibile per il caricamento locale.
- Prima dell'invio verificare il login del pacchetto destinato a questa scheda. Il client OAuth AniList deve avere come redirect l'identità effettiva dello Store; per questo ID la base è `https://gogibdaaglfefnemakliohebmcjfdddo.chromiumapp.org/`. Verificare il risultato effettivo di `chrome.identity.getRedirectURL()` e il redirect registrato sul client. Il client ID pubblico predefinito nel codice è `35100`, modificabile in fase di build; non è una credenziale personale. Non modificare il redirect a tentativi. [Guida OAuth](../OAUTH_SETUP.md).

## 2. Scheda dello Store

### Riepilogo dal pacchetto

```text
THIS EXTENSION IS FOR BETA TESTING. AniList calendar, ratings, Wrapped, friend alerts, Following groups and list tools.
```

### Descrizione

```text
Bring your AniList routine together.

AniList Ultimate (Unofficial) is a free, open-source companion for AniList, combining an airing calendar, personal ratings, visual recaps and tools for your lists and social feed.

YOUR AIRING WEEK
See upcoming episodes in a weekly calendar with countdowns, progress controls and configurable layouts. Keep your schedule and AniList progress close together.

ASTRA RATINGS AND JOURNAL
Organize your anime and manga with configurable scoring sections and weights. Keep season ratings, episode notes and a personal Journal, save supported changes to your own AniList lists, and export your local Astra archive as JSON.

WRAPPED RECAPS
Explore yearly, monthly or custom-period stories based on your logged AniList activity. Discover favorites, genres, studios, cast and other patterns, then download a PNG share card. Seasonal Wrapped adds broadcast-season rankings, personal awards, leftovers and continuing titles. Private and hidden titles are excluded initially; review your choices before sharing.

FRIEND ALERTS
Choose friends or a custom audience and follow their public progress and status updates for selected titles. Updates appear in a local Friend Alerts inbox inside AniList.

SMOOTHER EVERYDAY BROWSING
Filter your activity feed, group notifications, preview accessible list Notes, use bulk editing on your own anime and manga lists, and organize followed users into custom groups on title pages. Back Restore brings back loaded content, list filters and scroll position when you return to an AniList page. Media tools add public metadata, scores and opening/ending theme links.

MAKE IT YOURS
Enable the modules you want in settings. A free AniList account is needed for account-based features: connect your own account from the extension popup. No subscription is required.

YOUR DATA
Your Astra archive and login credentials are stored on your device, along with your custom Following group names and display settings; interface preferences may sync through your Chrome account. The extension reads AniList list data, activity and notification/message context needed for its features. Back Restore keeps limited AniList navigation and scroll state locally in the tab. User-requested list edits are sent to AniList, and media tools contact the public metadata providers described in the privacy policy. There are no ads, analytics, telemetry or sales of user data. Downloaded backups and share cards stay on your device until you choose to share them.

Wrapped reflects available logged activity, rather than measured video playback. Friend Alerts is an in-extension inbox; delivery depends on browser availability and AniList's API.

Created by ExAstra. This is an independent community project, not affiliated with or endorsed by AniList.

Source, documentation and release notes:
https://github.com/rikymarche-ctrl/anilist-ultimate

Support:
https://github.com/rikymarche-ctrl/anilist-ultimate/issues

Privacy policy:
https://github.com/rikymarche-ctrl/anilist-ultimate/blob/main/PRIVACY.md

THIS EXTENSION IS FOR BETA TESTING
```

### Campi aggiuntivi

| Campo | Valore |
| --- | --- |
| Categoria | Per divertirti / Entertainment |
| Lingua | English |
| URL ufficiale verificato | Nessuno. Non scegliere `anilist.co`: è un sito di terzi. |
| URL home page | `https://github.com/rikymarche-ctrl/anilist-ultimate` |
| URL assistenza | `https://github.com/rikymarche-ctrl/anilist-ultimate/issues` |
| Contenuti per adulti | No per i contenuti forniti dall'estensione e le grafiche della scheda; non includere materiale esplicito negli screenshot. |
| Assistenza per gli elementi | Lasciare Visibilità disattivata: il link di assistenza indirizza a GitHub Issues. Attivarla soltanto per gestire anche un secondo canale nell'hub dello Store. |
| Video promozionale YouTube | Lasciare vuoto: non è stato preparato un video. |

## 3. Privacy: singolo scopo

```text
Help AniList users organize, track and review their anime and manga activity within anilist.co. The extension integrates a weekly airing calendar, configurable ratings and Journal, activity-based recaps, list editing and related social/notification tools into that AniList workflow. Users choose the enabled modules and authenticate with their own AniList account when account data or edits are needed.
```

## 4. Privacy: motivazioni dei permessi

Compilare soltanto le motivazioni richieste dalla dashboard. Quelle per `alarms` e `unlimitedStorage` sono preparate per completezza: se Google non mostra i relativi campi, non occorre inserirle altrove. I due permessi sono comunque presenti nel pacchetto attuale e servono alle funzioni descritte sotto; verificarli nella scheda Pacchetto, senza dedurre la loro assenza dai soli campi del modulo privacy.

### storage

```text
Store the user's AniList OAuth token and account identity in trusted extension local storage, together with the local Astra ratings/Journal archive, custom friend lists and Following group names and display settings, pending user-requested AniList edits, alert state and disposable public metadata caches. Store interface settings in chrome.storage.sync and a public theme-video index in chrome.storage.session. Persistence keeps settings and local work available across visits and browser restarts. Credentials are not exposed through the content-script storage bridge.
```

### identity

```text
Use chrome.identity.launchWebAuthFlow for the user's explicit AniList OAuth sign-in and chrome.identity.getRedirectURL for the extension callback. A random state value and the returned origin/path are validated before accepting the token. The token is stored locally and sent only to AniList for authenticated list, activity and social requests and user-requested list edits. The extension does not read the user's AniList password or use identity to obtain a Google profile.
```

### unlimitedStorage

```text
Keep the local Astra archive, episode Journal, Notes recovery copies and pending synchronization records available as the user's library grows. These user-created records and backups can exceed chrome.storage.local's ordinary quota. The permission avoids losing local work because of that quota. It is used for extension-local data, not for access to arbitrary files, and does not increase the chrome.storage.sync quota or upload the archive to the developer.
```

### alarms

```text
Schedule background processing of queued AniList list edits and Friend Alerts checks while Chrome is running. The service worker registers periodic alarms (five-minute schedules) so it can retry pending user-requested changes and collect public progress/status updates for titles and audiences the user selected. These alarms support the extension's AniList tracking workflow; they do not create system push notifications or run analytics.
```

### Autorizzazione host

```text
https://anilist.co/*: insert the calendar, Astra, list/social tools and Back Restore only on AniList, and open AniList OAuth authorization. https://graphql.anilist.co/*: read AniList account/list/activity/notification data and submit list edits requested by the user. https://jikan.lucashdo.com/*: public MyAnimeList metadata and score lookups by numeric media ID or anime title. https://api.tenrai.org/*: opening/ending theme metadata by numeric MyAnimeList ID. https://toshy.github.io/*: public AnimeThemes video-link index and metadata. AniList tokens go only to AniList. Third-party metadata requests omit credentials and referrers; they contain no AniList token or account identity. No access to unrelated websites is requested.
```

### Usi codice remoto?

Selezionare **No, non uso codice remoto**. Il caricamento di JSON, immagini o video non è esecuzione di JavaScript remoto. Se la dashboard permette o richiede una spiegazione anche con No, usare:

```text
All executable JavaScript and extension logic are included in the uploaded package. There are no remote script tags, remotely imported executable modules, downloaded WebAssembly, eval-based code loading or remote executable updates. Remote requests retrieve AniList API data, public metadata, images and theme links, not code. Extension-page scripts are restricted to packaged resources by the manifest Content Security Policy. Fonts used in extension pages are bundled.
```

## 5. Privacy: utilizzo dei dati

Questa mappatura deriva dal codice corrente. Non selezionare "nessun dato" solo perché l'archivio è locale: Google richiede di dichiarare anche il trattamento sul dispositivo. Le categorie ampie seguenti hanno l'ambito specifico indicato, senza implicare accesso generale a email, cronologia o password.

| Casella della dashboard | Selezionare | Motivo e ambito effettivo |
| --- | --- | --- |
| Informazioni che consentono l'identificazione personale | Sì | Nome utente e ID account AniList; profili/avatar e identità sociali necessari alle funzioni AniList. Non vengono richiesti nome anagrafico, indirizzo o email. |
| Informazioni sanitarie | No | Nessuna funzione raccoglie informazioni sanitarie. |
| Dati finanziari e di pagamento | No | Nessun pagamento o trattamento finanziario. |
| Informazioni di autenticazione | Sì | Token OAuth AniList salvato localmente e inviato soltanto ad AniList; nessuna lettura della password. |
| Comunicazioni personali | Sì | Notification Cleaner può leggere attività e testo di messaggi accessibili tramite AniList. I dettagli dipendenti dall'utente restano nelle cache in memoria; Wrapped legge separatamente metadati dei messaggi ricevuti. |
| Posizione | No | Non viene rilevata o dedotta la posizione geografica. I provider ricevono l'IP nella normale connessione HTTPS, come descritto nella policy. |
| Cronologia web | Sì, limitata ad AniList | Back Restore conserva fino a 25 snapshot con percorso/query AniList e data di acquisizione nel sessionStorage della scheda. Nessun accesso all'API history di Chrome o ai siti estranei ad AniList. |
| Attività utente | Sì, limitata a Back Restore | Posizione di scorrimento, contenuto caricato e filtri della pagina per ripristinare il contesto; gli eventi di interazione servono anche a interrompere il ripristino. Nessun tracciamento analitico o registro generale dei tasti. |
| Contenuti dei siti web | Sì | Dati delle liste, note, valutazioni, attività/notifiche e metadati/immagini necessari alle funzioni AniList. |

Attestare **tutte e tre** le dichiarazioni: nessuna vendita/trasferimento al di fuori dei casi consentiti; nessun uso per scopi estranei alla finalità; nessun uso per credito o prestiti. Le chiamate ad AniList e ai provider necessari alle funzioni sono descritte nella policy: la dichiarazione non equivale ad assenza di connessioni di rete.

### URL norme sulla privacy

```text
https://github.com/rikymarche-ctrl/anilist-ultimate/blob/main/PRIVACY.md
```

La policy aggiornata nel file locale `PRIVACY.md` deve essere pubblicata a questo URL **prima dell'invio in revisione**. La vecchia policy non descriveva con sufficiente precisione lo storage di Back Restore e il testo dei messaggi nelle notifiche.

## 6. Istruzioni per i test

Questo passaggio è facoltativo e non è un requisito per la pubblicazione. Google lo indica soprattutto per elementi che richiedono credenziali limitate o un account a pagamento. AniList Ultimate non richiede un account speciale: lascia vuoti i campi delle credenziali e, se vuoi aiutare i revisori, incolla queste istruzioni nel campo con limite di 500 caratteri.

```text
Sign in through the extension popup with any free AniList account. Open anilist.co/home to check the airing calendar. Open Astra from AniList's navigation to try ratings, Journal and Wrapped. Wrapped uses AniList list activity, so a new account may show empty recaps. Enable or disable modules in extension settings. Bulk Editor only changes the signed-in user's own lists. No paid or restricted account is required.
```

Se una futura funzione richiedesse un accesso non pubblico, fornire solo un account di test dedicato nei campi privati della dashboard. Non inserire credenziali nel repository o in questa guida, e non condividere l'account personale ExAstra.

## 7. Distribuzione

- **Pagamenti:** Senza costi.
- **Visibilità:** Pubblico.
- **Regioni:** Tutte le regioni, per una distribuzione globale (controllare il selettore generale; alcune caselle selezionate non significano necessariamente tutte).
- **Assistenza:** mantenere il link a GitHub Issues.
- **Stato attuale:** bozza; nessun invio in revisione eseguito da questa preparazione.

### Notifiche per lo sviluppatore

Queste notifiche arrivano all'account sviluppatore, non agli utenti dell'estensione. Con GitHub Issues come unico canale di assistenza, impostazione consigliata:

| Impostazione | Email | Web |
| --- | --- | --- |
| Revisione degli articoli completata | Attiva | Attiva |
| Problema di assistenza per gli articoli ricevuto | Disattiva con hub interno disabilitato | Disattiva con hub interno disabilitato |
| Elemento con implementazione graduale | Disattiva per ora | Non previsto nel modulo mostrato |
| Elemento pubblicato | Attiva | Non previsto nel modulo mostrato |

La prima voce riguarda le recensioni lasciate dagli utenti, secondo la guida feedback di Google. Non va confusa con l'approvazione della revisione del pacchetto. Le notifiche delle issue GitHub si configurano separatamente su GitHub. Se si sceglie di abilitare anche l'hub di assistenza dello Store, attivare le relative notifiche Email/Web.

## 8. Immagini

I file pronti sono in `release/store-1.0.3/`. PNG degli screenshot e dei riquadri promozionali: RGB, senza alpha. L'icona può avere alpha.

| File | Dimensioni | Utilizzo |
| --- | --- | --- |
| `icon-128.png` | 128 × 128 | Icona della scheda, marchio AU su fondo scuro con margine trasparente per leggibilità anche sullo Store chiaro. |
| `promo-small-440x280.png` | 440 × 280 | Riquadro promozionale piccolo richiesto. |
| `promo-marquee-1400x560.png` | 1400 × 560 | Riquadro in primo piano opzionale. |
| `screenshot-01-settings-1280x800.png` | 1280 × 800 | Schermata effettiva delle impostazioni della build, senza dati personali. |
| `screenshot-02-wrapped-1280x800.png` | 1280 × 800 | Interfaccia Wrapped corrente con dati di esempio esplicitamente indicati; non è un account personale. |

Per una scheda più rappresentativa si possono sostituire/affiancare i due screenshot con catture del calendario, dashboard Astra e Journal in uso. Il massimo è cinque; non caricare schermate della dashboard sviluppatore, screenshot con errori o messaggi personali. Non è necessario riempire tutti e cinque gli slot. Conservare le proporzioni: niente stiramento per raggiungere 1280 × 800.

Ordine consigliato per i due screenshot preparati: **Wrapped**, poi **Settings**.

## Verifiche eseguite

- Build TypeScript/Vite completata per la versione 1.0.3.
- ZIP dell'estensione generato; manifest, risorse dichiarate e file HTML controllati.
- Test automatizzati e smoke test browser non eseguiti per questa versione.
- PNG riutilizzati dal kit 1.0.2; dimensioni e trasparenza già verificate per gli stessi file.
- Login OAuth reale del pacchetto Store, bozza online e invio in revisione: non eseguiti da questa preparazione.

## 9. Riferimenti ufficiali consultati

- [Campi della scheda](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)
- [Campi privacy e permessi](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [FAQ dati utente, compreso trattamento locale](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Immagini e dimensioni](https://developer.chrome.com/docs/webstore/images)
- [Istruzioni per i test](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)
- [Assistenza, recensioni e relative notifiche](https://developer.chrome.com/docs/webstore/support-users)
- [Notifiche sullo stato di pubblicazione](https://developer.chrome.com/docs/webstore/check-review)

Riscontri nel codice: `public/manifest.json`; `src/background.ts`; `src/core/auth/AuthService.ts`; `src/core/cache/CacheFactory.ts`; `src/core/services/PublicMediaClient.ts`; `src/core/services/MusicVideoClient.ts`; `src/modules/restore/PageStateStore.ts` e `PageStateTypes.ts`; `src/modules/notifications/services/NotificationActivityResponse.ts`; `src/api/queries/year-review.ts`.
