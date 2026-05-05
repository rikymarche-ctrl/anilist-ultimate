# Astra Codebase Deep Research & Audit (FULL SCAN)

This document contains a comprehensive analysis of architectural inconsistencies, technical debt, and critical vulnerabilities discovered during a deep-dive scan of the entire codebase.

---

## 1. High-Level Architectural Debt

### 1.1 Fragmented Batching & Throttling
- **The "Timer Jungle"**: Modules like `ReviewService` (900ms), `ActivityService` (500ms), and `AnilistClient` (700ms) all implement their own manual delays. 
- **Impact**: The extension is over-throttled, leading to perceived slowness. Throttling should be delegated EXCLUSIVELY to `AnilistClient`.
- **Batching Violations**: Several modules bypass `GraphQLBatcher` and construct their own aliases manually, violating DRY and making maintenance difficult.

### 1.2 Memory Leakage & RAM Usage
- **Heavy Caching**: `ReviewService` caches full review bodies (which can be several KB each) in memory for 500 entries. This can lead to 50MB+ RAM usage for a single service.
- **DI Container Leaks**: `CalendarDomService` creates child containers on every injection but never disposes of them.
- **BaseComponent Rerender Suicidio**: `BaseComponent.ts` destroys and recreates the entire DOM tree on every prop update. This is O(N) where N is the depth of the UI tree, causing massive CPU spikes and flickering in complex views like Astra Dashboard.

### 1.3 Architectural Fork (Background vs Content)
- **Standalone Background**: `background.ts` is written as a standalone script that doesn't use the DI container, the centralized logger, or the shared error handling.
- **Impact**: Code duplication (e.g., duplicated API logic) and impossibility to share state or services between the background worker and the UI.

---

## 2. "ROBA GROSSA" (Critical Performance & Stability)

### 2.1 Performance: Font Awesome JS (SVG Engine)
- **Issue**: Bundles the entire SVG engine in `main.ts`.
- **Impact**: Constant DOM scanning on every mutation. Bundle size 2MB.

### 2.2 Global Module Bloat
- **Issue**: Lack of `pageMatch` for 90% of modules in `setup.ts`.
- **Impact**: Social sidebars and review enhancers load on every page, wasting CPU even on static pages.

### 2.3 The "JSON Blob" Storage Bottleneck
- **Issue**: Single large JSON for all Astra data in `AstraService`.
- **Impact**: Full parse/stringify on every score update. As the user list grows, the save operation becomes slower and blocks the main thread.

### 2.4 Brute-Force DOM Management
- **Issue**: `CalendarDomService` creates artificial sections and hides native elements using `display: none` instead of cleaning them up.
- **Impact**: Potential crashes in AniList's native JavaScript (React/Next.js) when it tries to access or reconcile these "zombie" elements.

### 2.5 "Fake Background" Tasks
- **Issue**: `background.ts` lacks `chrome.alarms` management. 
- **Impact**: Periodic tasks (like notification checking) only happen when a content script is active. True background operation is non-existent.

---

## 3. Reliability & Testing (THE GAPS)

### 3.1 Near-Zero Test Coverage
- **Issue**: Only 3 test files in the entire project. Core logic (`AstraService`, `SocialService`, `CustomListService`) is completely untested.

### 3.2 Volatile Diagnostics
- **Issue**: Error history in `ErrorHandler` is not persisted to storage. It is wiped on background script restart (frequent in MV3).

### 3.3 "Lossy" API Queue
- **Issue**: `AnilistClient` clears its queue on context invalidation.
- **Impact**: Risk of **Permanent Data Loss** for Astra saves if they occur during an extension update or script suspension.

### 3.4 Stale Social Data
- **Issue**: `CustomListService` stores static usernames and avatars locally.
- **Impact**: UI becomes out-of-sync if friends change their profiles on AniList.

---

## 4. Proposed "Enterprise-Grade" Refactoring Roadmap

### Phase 1: Infrastructure & Reliability (High Priority)
- **Unify Throttling**: Remove all `setTimeout` calls from services; delegate to `AnilistClient`.
- **Persistent Queue**: Implement a persistent storage-backed queue for critical Astra mutations (Save Entry).
- **Standardize Batching**: Force all modules to use `GraphQLBatcher`.
- **MV3 Alarms**: Implement `chrome.alarms` for true background notification polling.

### Phase 2: Componentization & Storage
- **Atomic Astra**: Split `AstraDashboard` and `AstraRatingModal` into functional sub-components.
- **Fragmented Storage**: Break the single JSON blob into per-media keys (Atomic Storage).
- **BaseModal Core**: Create a robust modal base class to fix Focus Trap and ESC bugs globally.
- **DI Cleanup**: Implement proper disposal of child containers in `CalendarDomService`.

### Phase 3: Performance & Hygiene
- **Font Awesome Refactor**: Switch to tree-shaken SVGs or standard CSS icons.
- **Page-Matching Enforcement**: Add strict `pageMatch` to all modules in `setup.ts`.
- **Sanitization Layer**: Implement a centralized `Sanitizer` to eliminate `innerHTML` XSS risks.
- **Reconciliation Engine**: Improve `BaseComponent` to support partial DOM updates instead of full recreation.

### Phase 4: Data Integrity & UX
- **Dynamic User Metadata**: Change custom lists to store only IDs; fetch metadata at runtime or sync on load.
- **Config Resilience**: Add Export/Import and Reset functions to the Settings page.
- **Unified Logging**: Migrate `background.ts` to use the centralized `Logger` and `ErrorHandler`.
