# Anilist Ultimate - Architecture Documentation

## Table of Contents

- [1. System Overview](#1-system-overview)
- [2. Technology Stack](#2-technology-stack)
- [3. Project Structure](#3-project-structure)
- [4. Core Infrastructure](#4-core-infrastructure)
  - [4.1 Dependency Injection](#41-dependency-injection)
  - [4.2 Event Bus](#42-event-bus)
  - [4.3 Navigation Service](#43-navigation-service)
  - [4.4 Configuration Manager](#44-configuration-manager)
  - [4.5 Storage Manager](#45-storage-manager)
  - [4.6 State Management](#46-state-management)
  - [4.7 Error Handling](#47-error-handling)
  - [4.8 Authentication](#48-authentication)
  - [4.9 Logging](#49-logging)
- [5. Module System](#5-module-system)
  - [5.1 Module Lifecycle](#51-module-lifecycle)
  - [5.2 BaseModule](#52-basemodule)
  - [5.3 Module Registry](#53-module-registry)
- [6. API Layer](#6-api-layer)
- [7. Build System](#7-build-system)
- [8. Data Flow Diagrams](#8-data-flow-diagrams)

---

## 1. System Overview

Anilist Ultimate v2 is a **Chrome Extension** (Manifest V3) that enhances the [AniList](https://anilist.co) anime tracking website. It operates as a **content script** injected into `https://anilist.co/*` pages, modifying the DOM to add features like an airing calendar, social activity overlays, notification grouping, advanced scoring (Astra), and more.

### High-Level Architecture

```
+------------------------------------------------------------------+
|                        Chrome Extension                          |
|------------------------------------------------------------------|
|  manifest.json (MV3)                                             |
|    -> content_scripts: src/main.ts                               |
|    -> popup: popup.html                                          |
+------------------------------------------------------------------+
                                |
                                v
+------------------------------------------------------------------+
|                            main.ts                               |
|  1. Import reflect-metadata (tsyringe)                           |
|  2. Call setupDI() -> register all services                      |
|  3. OAuth callback handling                                      |
|  4. ThemeManager init                                            |
|  5. Font Awesome injection                                       |
|  6. ModuleRegistry.initAll()                                     |
+------------------------------------------------------------------+
                                |
                                v
+------------------------------------------------------------------+
|                     DI Container (tsyringe)                      |
|------------------------------------------------------------------|
|  Tokens (Symbols)  ->  Service Implementations                   |
|  TOKENS.EventBus   ->  EventBus (singleton)                      |
|  TOKENS.Config     ->  ConfigManager (singleton)                 |
|  TOKENS.ApiClient  ->  AnilistClient (singleton)                 |
|  TOKENS.Storage    ->  StorageManager (instance)                 |
|  ...               ->  ...                                       |
+------------------------------------------------------------------+
                                |
                                v
+------------------------------------------------------------------+
|                        Module Registry                           |
|------------------------------------------------------------------|
|  Registered Modules (ModuleMetadata[]):                          |
|  - calendar        (home page)                                   |
|  - hoverComments   (media pages)                                 |
|  - notificationCleaner (notification pages)                      |
|  - reviewEnhancer  (all pages)                                   |
|  - activityEnhancer (home page)                                  |
|  - forumEnhancer   (forum pages)                                 |
|  - activityScore   (all pages)                                   |
|  - socialActivity  (all pages)                                   |
|  - socialEnhancer  (all pages)                                   |
|  - customList      (all pages)                                   |
|  - mediaSocialEnhancer (all pages)                               |
|  - astra           (home + user pages)                           |
+------------------------------------------------------------------+
```

### Design Principles

1. **Dependency Injection** - All services are registered in a central DI container (tsyringe) and resolved via constructor injection
2. **Module Pattern** - Each feature is encapsulated in a module that extends `BaseModule`
3. **Event-Driven Communication** - Modules communicate via a centralized `EventBus` (pub/sub)
4. **SPA-Aware Navigation** - A centralized `NavigationService` intercepts AniList's SPA routing
5. **Feature Flags** - Every module can be toggled via `ConfigManager`
6. **Centralized UI Event Handling** - Large UI components (like AstraDashboard) handle their own global open/close events via EventBus listeners in their constructor. This ensures availability regardless of module lifecycle states or async initialization delays.

---

## 2. Technology Stack

| Layer        | Technology         | Version    | Purpose                        |
| ------------ | ------------------ | ---------- | ------------------------------ |
| Language     | TypeScript         | 5.4+       | Type safety, decorators        |
| Build        | Vite               | 5.2+       | Bundling, HMR, code splitting  |
| Extension    | @crxjs/vite-plugin | 2.0-beta   | Manifest V3 integration        |
| DI           | tsyringe           | 4.10       | Dependency injection container |
| Reflection   | reflect-metadata   | 0.2        | Decorator metadata for DI      |
| API          | graphql-request    | 6.1        | GraphQL client for AniList API |
| API Types    | graphql            | 16.8       | GraphQL schema types           |
| Testing      | Vitest             | 1.6        | Unit testing framework         |
| Linting      | ESLint + Prettier  | 8.57 / 3.2 | Code quality                   |
| Minification | Terser             | 5.46       | Production minification        |

---

## 3. Project Structure

```
anilist-ultimate-v2/
├── public/
│   ├── manifest.json          # Chrome MV3 manifest
│   └── icons/                 # Extension icons (16, 48, 128)
├── src/
│   ├── main.ts                # Entry point - bootstraps the extension
│   ├── setup.ts               # DI container configuration
│   ├── core/                  # Core infrastructure (framework)
│   │   ├── auth/              # OAuth token management
│   │   │   └── AuthTokenService.ts
│   │   ├── config/            # Configuration system
│   │   │   ├── ConfigManager.ts
│   │   │   ├── defaults.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── di/                # Dependency injection
│   │   │   ├── container.ts   # tsyringe container instance
│   │   │   ├── tokens.ts      # Symbol-based DI tokens
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── errors/            # Error handling system
│   │   │   ├── ErrorHandler.ts
│   │   │   ├── ErrorTypes.ts
│   │   │   └── index.ts
│   │   ├── events/            # Event bus (pub/sub)
│   │   │   ├── EventBus.ts
│   │   │   ├── EventTypes.ts
│   │   │   ├── GlobalEvents.ts
│   │   │   └── index.ts
│   │   ├── interfaces/        # Interface contracts
│   │   │   ├── IApiClient.ts
│   │   │   ├── IConfigManager.ts
│   │   │   ├── IErrorHandler.ts
│   │   │   ├── IEventBus.ts
│   │   │   ├── ILogger.ts
│   │   │   ├── IModule.ts
│   │   │   ├── IStorageService.ts
│   │   │   └── index.ts
│   │   ├── modules/           # Module system framework
│   │   │   ├── BaseModule.ts  # Abstract base class
│   │   │   ├── ModuleLoader.ts
│   │   │   ├── ModuleRegistry.ts
│   │   │   ├── decorators.ts
│   │   │   └── index.ts
│   │   ├── navigation/        # SPA navigation tracking
│   │   │   └── NavigationService.ts
│   │   ├── services/          # Shared services
│   │   │   └── ToastService.ts
│   │   ├── state/             # Reactive state store
│   │   │   └── Store.ts
│   │   ├── storage/           # Chrome storage wrapper
│   │   │   └── StorageManager.ts
│   │   ├── utils/             # Utility functions
│   │   │   ├── ScoreFormatter.ts
│   │   │   └── Template.ts
│   │   ├── constants.ts       # Global constants
│   │   ├── logger.ts          # Logging utility
│   │   ├── ThemeManager.ts    # Theme detection
│   │   └── types.ts           # Shared type definitions
│   ├── api/                   # AniList API layer
│   │   ├── AnilistClient.ts   # GraphQL client with rate limiting
│   │   ├── AnilistTypes.ts    # API response types
│   │   ├── queries/           # GraphQL query definitions
│   │   │   └── calendar.ts
│   │   └── index.ts
│   ├── modules/               # Feature modules
│   │   ├── activity/          # Activity feed enhancement
│   │   ├── astra/             # Advanced scoring system
│   │   ├── calendar/          # Airing schedule calendar
│   │   ├── forum/             # Forum enhancements
│   │   ├── notifications/     # Notification grouping
│   │   ├── reviews/           # Review score display
│   │   └── social/            # Social features (friends, lists)
│   ├── ui/                    # Shared UI components
│   │   └── components/
│   │       ├── BaseComponent.ts
│   │       ├── Toast.ts
│   │       └── ToastContainer.ts
│   └── styles/                # CSS stylesheets
│       ├── main.css
│       ├── calendar.css
│       ├── settings-panel.css
│       ├── notification-cleaner.css
│       ├── activity-enhancer.css
│       ├── activity-score.css
│       ├── astra.css
│       ├── custom-lists.css
│       ├── forum-enhancer.css
│       ├── hover-comments.css
│       ├── review-enhancer.css
│       ├── social-activity.css
│       └── toast.css
├── dist/                      # Build output
├── package.json
├── tsconfig.json
├── vite.config.ts
└── docs/                      # Documentation
```

---

## 4. Core Infrastructure

### 4.1 Dependency Injection

**File:** `src/core/di/`

The extension uses [tsyringe](https://github.com/microsoft/tsyringe) for dependency injection, configured manually in `setup.ts`.

**Tokens** (`tokens.ts`): Symbol-based tokens registered via `Symbol.for()` for cross-module sharing.

**Container** (`container.ts`): Re-exports the tsyringe global container.

**Registration Flow:**

```
setupDI() in setup.ts
  1. Register core infrastructure (Logger, Storage, EventBus, Config, ErrorHandler)
  2. Register API client
  3. Register Auth service
  4. Register feature services (Calendar, Social, Activity, Notification, Astra)
  5. Load configuration from storage
  6. Setup global error handlers
  7. Initialize Toast service
  8. Start Navigation service
  9. Register all modules in ModuleRegistry
```

**Pattern:** All services use `@injectable()` decorator. Singletons use `container.registerSingleton()`. Constructor parameters use `@inject(TOKENS.XYZ)`.

### 4.2 Event Bus

**File:** `src/core/events/EventBus.ts`

Lightweight pub/sub system for decoupled module communication.

**Key Features:**

- Type-safe events via `AppEventMap` interface
- `on()` / `off()` / `emit()` / `once()` methods
- Async error handling (handler errors don't crash emitters)
- Debug mode for event logging
- Automatic cleanup of empty handler sets

**Event Categories:**

- `module:*` - Module lifecycle (initialized, destroyed, error)
- `calendar:*` - Calendar data and settings
- `social:*` - Friend activity, custom lists
- `activity:*` - Activity feed filtering
- `navigation:*` - SPA page changes
- `error:*` - Centralized error events
- `config:*` - Configuration changes
- `auth:*` - Authentication state
- `astra:*` - Astra scoring system

### 4.3 Navigation Service

**File:** `src/core/navigation/NavigationService.ts`

Centralizes SPA navigation detection. AniList is a Vue.js SPA, so page changes don't trigger full reloads.

**Detection Methods (3 layers):**

1. `MutationObserver` on `document.body` (catches DOM changes from routing)
2. `popstate` event listener (browser back/forward)
3. Monkey-patched `history.pushState` / `history.replaceState` (intercepts programmatic navigation)

When a path change is detected, emits `EVENT_TYPES.PAGE_CHANGED` with `{ path, previousPath, timestamp }`.

### 4.4 Configuration Manager

**File:** `src/core/config/ConfigManager.ts`

Centralized configuration with persistence, feature flags, and change listeners.

**Storage:** Chrome sync storage under key `anilist_ultimate_v2_config`.

**Config Structure** (see `types.ts`):

- `features` - Feature flags for each module (boolean toggles)
- `debug` - Debug logging settings
- `api` - API endpoint, timeout, rate limiting
- `oauth` - OAuth client configuration
- `calendar` - Calendar display preferences
- `cache` - Cache durations

**Change Notification:**

- `onChange(key, callback)` method for reactive updates
- Emits `CONFIG_CHANGED` events via EventBus
- Deep merge with defaults on load (handles schema evolution)

### 4.5 Storage Manager

**File:** `src/core/storage/StorageManager.ts`

Type-safe wrapper around `chrome.storage` API.

**Two Instances:**

- `syncStorage` - Chrome sync storage (small data, synced across devices)
- `localStorage` - Chrome local storage (large data, device-local)

**Features:**

- Automatic key prefixing (`anilist_ultimate_v2_`)
- Anti-double-prefix protection
- `onChange()` listener for reactive updates
- Storage quota monitoring via `getUsage()`
- Batch operations (`getMultiple`, `setMultiple`)

### 4.6 State Management

**File:** `src/core/state/Store.ts`

Custom lightweight reactive store (~175 lines, zero dependencies).

**Features:**

- `getState()` / `setState()` with partial updates
- `subscribe()` for global change listeners
- `subscribeToSelector()` for targeted subscriptions with shallow equality checks
- `batch()` for multiple updates with single notification
- `createMemoizedSelector()` for expensive computed values
- `combineStores()` for composed state

**Used by:** `CalendarStore` for managing calendar state (entries, preferences, loading states).

### 4.7 Error Handling

**File:** `src/core/errors/`

**Custom Error Types** (`ErrorTypes.ts`):

- `ApiError` - API request failures (statusCode, endpoint, retryCount)
- `ModuleError` - Module lifecycle failures (moduleName, context)
- `StorageError` - Storage operations (operation, storageKey)
- `ConfigError` - Configuration issues (configKey)
- `AuthError` - Authentication problems (reason)
- `ValidationError` - Data validation (field, expectedType)

**ErrorHandler** (`ErrorHandler.ts`):

- Centralized error handling with severity levels (Low, Medium, High, Critical)
- Error history tracking (last 100 errors)
- Global `unhandledrejection` and `error` event listeners
- Type-specific handling (API errors emit AUTH_REQUIRED for 401/403)
- **Detailed GQL Error Extraction**: Extracts specific error messages from AniList GraphQL `response.errors` payload for precise debugging.
- **Immediate User Feedback**: Emits `API_ERROR` events that trigger `ToastService` alerts for critical or transient errors (e.g., Rate Limits).
- Error statistics and reporting

### 4.8 Authentication

**File:** `src/core/auth/AuthTokenService.ts`

Centralized OAuth token management.

**Flow:**

1. User authorizes via AniList OAuth (implicit grant)
2. Redirect with `#access_token=...` in URL hash
3. `main.ts:checkOAuthCallback()` extracts and saves via `AuthTokenService`
4. Token stored in `localStorage` under `anilist_ultimate_v2_access_token`
5. Legacy keys (`access_token`, `accessToken`, `token`, `auth_token`, `jwt`) are migrated and cleaned up

**Token caching:** In-memory cache (`cachedToken`) avoids repeated `localStorage` reads.

### 4.9 Logging

**File:** `src/core/logger.ts`

Structured logging with colored console output.

**Levels:** `debug`, `info`, `warn`, `error`, `success`

**Features:**

- Configurable prefix: `[Anilist Ultimate]`
- Colored output via CSS styles
- Group/groupEnd for nested logging
- Production build strips `console.log`, `console.debug`, `console.info` via Terser

---

## 5. Module System

### 5.1 Module Lifecycle

```
Registration (setup.ts)
  -> ModuleRegistry.register(metadata)
     -> { name, description, enabled, factory, pageMatch? }

Initialization (registry.initAll())
  -> For each module:
     1. Check enabled flag
     2. Check pageMatch (current URL)
     3. Check dependencies
     4. Call factory() to create instance
     5. Call instance.init()
     6. Store instance in registry
     7. Emit MODULE_INITIALIZED event

SPA Navigation Support (registry.checkPendingModules())
  -> On `PAGE_CHANGED` event:
     1. Find modules in `pending` status
     2. Re-check `pageMatch` against new URL
     3. Initialize matching modules (late-binding)
     4. Ensures modules wake up even after dynamic navigation.

Runtime
  -> Module listens to PAGE_CHANGED events
  -> Module uses MutationObservers for DOM changes
  -> Module communicates via EventBus

Destruction
  -> registry.destroyModule(name)
     -> Call instance.destroy()
     -> Clean up observers, subscriptions
     -> Emit MODULE_DESTROYED event
```

### 5.2 BaseModule

**File:** `src/core/modules/BaseModule.ts`

Abstract base class providing:

- **Observer Management** - `registerObserver()` with built-in throttling and suspension
- **Suspension Pattern** - `suspendObserver()` / `resumeObserver()` prevents recursive MutationObserver loops
- **Navigation Integration** - `onPageChange()` subscribes to centralized navigation events
- **Element Waiting** - `waitForElement(selector, timeout)` with polling
- **Event Integration** - `subscribe()` / `emit()` helpers for EventBus
- **Lifecycle** - `cleanup()` and `destroy()` with automatic resource cleanup

### 5.3 Module Registry

**File:** `src/core/modules/ModuleRegistry.ts`

Manages module registration, initialization order, and lifecycle.

**Features:**

- **SPA-Aware Initialization**: Listens to `PAGE_CHANGED` events to initialize modules that didn't match the initial page load URL.
- **Critical Modules**: Initialize sequentially first (blocking).
- **Non-Critical Modules**: Initialize in parallel (`Promise.allSettled`).
- **Status Tracking**: pending, initializing, initialized, failed.
- **Dependency Resolution**: Modules can declare dependencies that must be initialized first.
- **Destruction**: In reverse order (LIFO).

---

## 6. API Layer

**File:** `src/api/AnilistClient.ts`

GraphQL client for the AniList API (`https://graphql.anilist.co`).

**Rate Limiting:**

- Max 90 requests/minute (AniList limit)
- 700ms delay between requests
- Max 2 concurrent requests
- Automatic queue management

**Retry Strategy:**

- 3 retry attempts
- Exponential backoff (1s, 2s, 4s)
- Rate limit detection (HTTP 429) with 60s cooldown

**Queue System:**

```
query()/mutate() -> push to queue -> processQueue()
  -> Check: !rateLimited && activeRequests < maxConcurrent && queue.length > 0
  -> Shift item from queue
    -> executeRequest(item)
    -> On success: resolve promise
    -> On rate limit: 
       1. Emit `API_ERROR` (status 429) to trigger user Toast
       2. Put back in queue, wait 60s
    -> On error + retries left: exponential backoff, retry
    -> On error + no retries: 
       1. Extract detailed GQL message if available
       2. Reject with formatted `ApiError`
    -> Finally: delay 700ms, process next
```

**Alias Batching Pattern:**
Multiple modules use GraphQL alias batching to fetch multiple resources in a single request:

```graphql
query {
  m123: Page(perPage: 6) { mediaList(mediaId: 123, ...) { ... } }
  m456: Page(perPage: 6) { mediaList(mediaId: 456, ...) { ... } }
}
```

This reduces total API calls significantly.

---

## 7. Build System

**File:** `vite.config.ts`

**Vite + @crxjs/vite-plugin** for Chrome Extension development.

**Key Configuration:**

- Path aliases: `@/` -> `src/`, `@core/` -> `src/core/`, etc.
- Manual chunks: `vendor` bundle for tsyringe + reflect-metadata
- Terser minification with console stripping in production
- HMR on port 5173

**Build Output:**

```
dist/
├── assets/
│   ├── [name]-[hash].js    # JS chunks
│   └── [name]-[hash].css   # CSS assets
├── manifest.json            # Processed manifest
└── popup.html               # Extension popup
```

---

## 8. Data Flow Diagrams

### Page Load Flow

```
Browser loads anilist.co
  -> Content script injected (document_idle)
  -> main.ts: init()
     -> setupDI(): Register all services
     -> ConfigManager.load(): Load settings from chrome.storage.sync
     -> ErrorHandler.setupGlobalHandlers()
     -> NavigationService.start(): Begin watching URL changes
     -> ModuleRegistry.initAll():
        -> For each enabled module matching current page:
           -> factory() creates instance via DI
           -> module.init() starts feature
```

### Navigation Flow

```
User clicks link on AniList (SPA navigation)
  -> Vue Router calls history.pushState()
  -> NavigationService.interceptHistoryMethods() catches it
  -> NavigationService.checkPathChange() detects new path
  -> EventBus.emit(PAGE_CHANGED, { path, previousPath })
  -> All subscribed modules receive event
  -> Each module: cleanup old state, check if new page matches, initialize if needed
```

### API Request Flow

```
Module needs data
  -> apiClient.query(graphql, variables)
  -> New Promise created, pushed to queue
  -> processQueue() checks rate limit + concurrency
  -> executeRequest() sends via graphql-request
  -> Response resolved to caller
  -> 700ms delay before next request
```
