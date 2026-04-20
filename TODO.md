# Anilist Ultimate - TODO & Future Enhancements

Questo file traccia le funzionalità pianificate e i miglioramenti da apportare ai vari moduli dell'estensione.

## 🧹 Notification Cleaner (Anti-Spam)
- [ ] **Dropdown per Dettagli**: Aggiungere un menu a discesa (dropdown) nelle notifiche raggruppate che mostri l'elenco dei singoli eventi originali.
- [ ] **Navigazione Multipla**: Fare in modo che il numero di attività cliccabile (es. "liked **4** activities") permetta di visualizzare o navigare tra tutte le attività coinvolte, non solo l'ultima.
- [ ] **Supporto altri tipi**: Estendere il raggruppamento anche per "scraped activity", "mentions" o "replies" se provenienti dallo stesso utente in un breve lasso di tempo.

## 🌐 Social Activity (Activity Enhancer)
- [ ] **Persistenza Filtri**: Salvare i filtri selezionati (es. "Read only") nello storage per ritrovarli al prossimo caricamento.
- [ ] **Pulsante "Unmerge" veloce**: Permettere di espandere un singolo blocco mergiato senza dover de-mergiare tutto il feed.
- [ ] **Counter globale**: Mostrare quante attività sono state rimosse/mergiate per dare un feedback sull'ordine creato nel feed.

## ⭐ Review Enhancer
- [ ] **Filtro per Voto**: Aggiungere la possibilità di filtrare le recensioni in base al punteggio (es. "Mostra solo recensioni sopra 80").
- [ ] **Integrazione Profile**: Assicurarsi che i voti appaiano in modo consistente anche nella scheda "Reviews" del profilo utente.

## 📅 Calendar
- [ ] **Notifiche Desktop**: Opzione per ricevere una notifica browser quando un anime della propria lista sta per andare in onda.
- [ ] **Sync Google Calendar**: Esportazione degli airing times verso calendari esterni.

## 🛠 Core & Performance
- [ ] **Shadow DOM**: Valutare lo spostamento della UI iniettata in uno Shadow DOM per evitare conflitti CSS con AniList.
- [ ] **I18n**: Supporto multilingua (Italiano/Inglese) per tutte le etichette dell'estensione.
