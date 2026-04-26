# AniList Ultimate - TODO

## 🛠️ In Progress / Stabilization

- [ ] **Notification Cleaner Stability**: se scrollo troppo in basso nelle notifiche a un certo punto smette di mergarle. Investigate race condition o batching del DOM.
- [ ] **Activity Filter Refresh**: quando in un activity seleziono tipo una lista e cambio pagina, BISOGNA FARE IL REFRESH DEI FILTRI, altrimenti si bugga.
- [ ] **Custom List Auto-Reset**: ero fermo con una custom list nell activity, ma penso anilist abbia mandato un refresh (quello per le nuove interazioni), ma è tornato automaticamente su global. Bisogna gestirle!
- [ ] **Hover Comments Stabilization**: Fix layout regressions and performance during rapid scrolling.

## 📈 Notification Cleaner (Progress Update)

- [X] **Consecutive Grouping**: ora mergia solo se sono consecutivi (se un altro utente si intrufola, le divide).
- [X] **Timestamp Range**: implementato `[Recente] - [Vecchio]`. Stile piccolo (1.1rem), grigio (lighter text), opacità 0.8.
- [X] **Virtual Card Behavior**: i padri aprono solo il dropdown, i figli hanno il link all'attività originale.
- [X] **Reply Logic**: sistemata la parte col "with", ora estrae la risposta reale.
- [X] **Robust ID**: uso di `data-au-user` per evitare che si rompa il match tra batch diversi.

## 📊 Notes & Ideas

IMPORTANTE. IL LOGIN ORA UTILIZZA IL NUMRO FISSO

- [ ] **Query Voti**: ricontrollare le query coi voti delle persone nelle activity. mi sa che ci sono degli errori.
- [ ] **Colori**: i Colori di anilist differiscono da quelli scelti (viola ecc).
- [ ] **Caching**: anche le notifiche si possono cachare dai.
- [ ] **Private Messages**: nelle notifiche capire se il messaggio "sent" è segreto (occhiolino png) o pubblico.
- [ ] **Spam Protection**: se spammo merge/unmerge si fuckuppa tutto.

nell activity c è renderizzato malissimo per le custom lists. usare cloni

controlalre bene se tra i cambi pagina tutto funziona perfettamente

implementare il fatto che il resize della pagina non distrugga gli elementi

vorrei fare un rework grafico alla social activity dal calendario (le custom lists non funzionano per nulla qua)

estensione funzionalità social con avatar anche a anime e manga in progress, essenzialmente il bottone a pillola

l icona dei commenti fa schifo, pochissima definziiione. INoltre i commenti devono NON saprire anche quando hovero il loro popup, non solo l cione nuvoletta!

Le notifiche hanno un botto di problemi ziocantaS

nel calendario se showfriend avatars è on ma non ci sono amici, non si vede nemmeno l avatr generale per aprire la social activity!

filtri condizionali ai criteri per il voto. se do 3 alla grafica a un anime del 1990 non deve influire come se lo dessi ad uno di oggi. Per questo magari fare ad esempio un filtro condizionale che permette al voto di allontanarsi di un massimo di 2 voti dalla media pesata senza se stesso. qualcosa del genere. se tutti fossero csoì ci sarebbero problemi però, quindi andrebbe data una priorità, anche se altissimamente improbabile

in astra, aggiungere i Private, quelli defautl di anilist, come sezione


in astra, lo show progress funziona solo se prima si resyncano le stats. non ha senso


contry e type possono stare ciacuno sempre attivo, assimee ovviamente ai filtri sotto. Possono essere uno per categoria sempre attivi, non sono mutuali.

il contenuto delle righe non occupa sempre tutto lo spazio orizzontale. DEVE, non voglio che dipende dal contenuto

all statuses mi puzza LGGERMENTE di grafica fuori posto. tutto maiuscolo, boh


il wrapped fa cacare per ora


OGNI MODULO DELL ESTENSIONE, AD ESEMPIO COMMENTI, CALENDARIO ECC SARÀ OPTABILE IN E OUT. OGNI UTENTE DALLE IMPOSTAZIONI DELL ESTENSIONE IN GENERALE, QUELLA PROPRIO DAL BROWSER. POTRÀ DECIDERE COSA VUOEL.


Global Weight va spostato a sinistra


mettere gli all come filtri predefiniti, in tutte e 3 le sezioni


la barra del progress farla leggermente più scura, non così tanto azzurra

il bottone di all statuses si bugga graficamente, si ripetono le frecce del drowdown all interno quando una voce è selezionata. all infinito


setuppare qualche observer per il cambio di pagina perchè ogni votla devo refreshare tutto a mano, che palle.


un sistema di caching intelligente. se vado avanti e torno indeitro non può fare così schifo. oltre che a chachare notifiche e reviews almeno dai
