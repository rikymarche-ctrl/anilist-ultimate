# Astra Module Diagrams

This file serves as a persistent repository for all architectural diagrams related to the Astra module.

## 1. Synchronization Flow (AniList <-> Astra)

This diagram illustrates the "Top-Block-Bottom" decomposition and the JIT (Just-In-Time) pull strategy used when opening the rating modal.

```mermaid
sequenceDiagram
    participant UI as Astra Modal
    participant SM as SyncManager
    participant RS as RatingService
    participant AL as AniList API
    participant Rep as Repository
    participant Parser as ParserService

    UI->>SM: open(mediaId)
    SM->>RS: getMediaRatingData(mediaId)
    RS->>AL: Fetch GQL (Notes + Metadata)
    AL-->>RS: Response
    RS-->>SM: Raw Notes Data
    SM->>Parser: parse(rawNotes)
    Parser-->>SM: ParsedAstraReport
    SM->>Parser: merge(localWork, parsedReport)
    Parser-->>SM: Updated Work (Atomic)
    SM->>Rep: saveWork(work)
    SM-->>UI: Ready to Render
    UI->>UI: Populate General Thoughts
```

## 2. Save & Sync Pipeline

How Astra ensures that local ratings are safely pushed to AniList without destroying user comments.

```mermaid
graph TD
    A[User Clicks Save] --> B[Calculate Overall Score]
    B --> C{appendAstraToComment?}
    C -- YES --> D[Fetch Latest AniList Notes]
    D --> E[Parser.inject Astra Block]
    E --> F[Push to AniList Mutation]
    C -- NO --> G[Push Astra Data to Metadata Fields]
    G --> F
    F --> H[Emit ASTRA_DATA_UPDATED]
    H --> I[Refresh Dashboard UI]
```

## 3. Module Lifecycle & DI

```mermaid
graph LR
    subService[AstraService] -->|inject| repo[AstraRepository]
    subService -->|inject| parser[AstraParserService]
    manager[AstraSyncManager] -->|inject| subService
    controller[AstraRatingController] -->|inject| manager
    controller -->|inject| store[AstraRatingStore]
```

## 4. Modal-to-Dashboard Navigation (Back Flow)

```mermaid
sequenceDiagram
    participant RC as AstraRatingController
    participant EB as EventBus
    participant DB as AstraDashboard
    participant WT as AstraWorkTable

    Note over RC: User clicks "A" (Back)
    RC->>RC: save(shouldClose=true, skipSync=false)
    Note over RC: Wait for save completion
    RC->>EB: emit(ASTRA_OPEN, { highlightMediaId })
    EB->>DB: open({ highlightMediaId })
    DB->>DB: mount components
    DB->>WT: update(state, highlightMediaId)
    WT->>WT: render rows
    WT->>WT: find row[data-media-id=highlightMediaId]
    WT->>WT: scrollIntoView()
    WT->>WT: addClass('astra-row-highlight')
```
