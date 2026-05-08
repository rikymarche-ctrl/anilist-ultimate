# Antigravity Mastery Guide

Hai ragione: per evitare refactor ripetitivi e massimizzare la precisione, dobbiamo passare da un approccio "tentativo" a un approccio **"Engineering-First"**. Ecco come possiamo ottimizzare il nostro flusso di lavoro.

## 1. Il Ciclo di Sviluppo Ottimizzato

Invece di chiedere subito la modifica, usa queste fasi:

### **Fase 1: Context & Audit**
> "Esegui un audit di `@nome_file` rispetto agli standard del repo. Verifica in particolare [specifica criticità, es: dipendenze circolari]."
- **Strumento:** `@/audit-and-align` o `@/rigorous-refactor`.

### **Fase 2: Design Document (Mermaid)**
> "Prima di scrivere codice, proponi un diagramma Mermaid del nuovo flusso per `@Feature`. Salva il diagramma in `docs/astra/DIAGRAMS.md`."
- **Perché:** Vedere il flusso graficamente ci permette di individuare bug logici (come quelli dei sync) PRIMA di scrivere una riga di TS.

### **Fase 3: Implementation Plan**
> "Crea un `implementation_plan.md` dettagliato. Non procedere finché non approvo la struttura."

---

## 2. Power Prompts (Esempi Pronti all'Uso)

Ecco alcuni prompt "ad alta efficienza" che puoi copiare/incollare per guidarmi meglio:

### **Per la Sincronizzazione:**
> "@Antigravity: Analizza il flusso di sync in `AstraSyncManager`. Assicurati che ogni azione che modifica lo stato locale emetta l'evento corretto e che il parser non 'inghiotta' i dati se le etichette non sono in caps."

### **Per i Refactor UI:**
> "@Antigravity: Voglio aggiungere [Feature X] al modal. Segui il pattern di `AstraScoreForm`: usa `html` template, inietta lo store nel metodo `connect` e non usare stati locali nel controller."

### **Per il "Deep Clean":**
> "@/rigorous-refactor dei file aperti. Focus: eliminazione di logic duplication e centralizzazione dei log di debug."

---

## 3. Manutenzione della Conoscenza

Antigravity impara dal contesto. Più documentazione scriviamo (come abbiamo fatto ora con `ARCHITECTURE.md`), più sarò preciso nei prossimi suggerimenti perché saprò esattamente quali sono i "contratti" tra i moduli.

**Prossimo Step Consigliato:**
Quando iniziamo una nuova feature, dimmi: *"Useremo il flusso Engineering-First. Fase 1: Design."*
Io genererò il diagramma e il piano prima di ogni altra cosa.
