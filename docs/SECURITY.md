# Anilist Ultimate - Security Audit Report

**Audit Date:** 2026-04-26
**Auditor:** Automated Code Review
**Scope:** Full codebase (`src/`)
**Severity Scale:** Critical > High > Medium > Low > Info

---

## Executive Summary

The codebase contains **4 critical**, **4 high**, **6 medium**, and **4 low** severity findings. The most impactful issues are **XSS via innerHTML**, **GraphQL injection via string interpolation** (3 locations), and **token management inconsistencies**.

---

## 🔄 Code Review Follow-up — 2026-06-13

A second review pass resolved the remaining injection/XSS findings and hardened the shared layers. Net status of the critical/high security surface:

- **GraphQL injection — fully closed.** `GraphQLBatcher.format()` now always quotes and escapes string values (removed the `$`-passthrough; escapes `\ " \n \r \t`), so every batched/inlined value is safe by construction. `HoverCommentsModule` was reverted to a vulnerable state by an external edit and **re-fixed** to use GraphQL variables. A full-tree grep confirms **no `userName:"${...}"` / `mediaId:${...}` interpolation remains** in `src/`. → **SEC-002 and SEC-018: RESOLVED.**
- **New XSS fixed — SEC-019:** `AstraRadarChart.getHTML()` interpolated user-editable section names raw into an `innerHTML` SVG string (exploitable via Settings or `importJSON`). Now escaped via `escapeHtml()`.
- **Self-XSS fixed:** `CustomListManager` search-empty-state now renders through the auto-escaping `html` template.
- **Dead/bypassable code removed:** `Sanitizer.sanitize()` / `formatMultiline()` deleted (unused; `sanitize()` was bypassable, e.g. `java\tscript:`). Only `Sanitizer.escape()` remains, now unit-tested.
- **Regression guards:** the XSS/injection fixes are now locked by unit tests (`GraphQLBatcher`, `Template`, `Sanitizer`, `AstraParserService`). 109 tests across 12 files; `tsc --noEmit` clean.

> **Hardening sweep (2026-06-13): all remaining actionable items RESOLVED.**
> - SEC-005 — Font Awesome bundled locally (no runtime CDN).
> - SEC-006 — `NavigationService.stop()` restores the patched `history.pushState/replaceState`.
> - SEC-007 — `importJSON()` validates shape (arrays/objects + numeric mediaId) before writing to storage.
> - SEC-008 / SEC-012 — `DEBUG.ENABLED` and the `window.AnilistUltimate` debug object are gated behind `import.meta.env.DEV`.
> - SEC-010 — HoverComments notes cache capped (`MAX_CACHE_ENTRIES=500`, oldest-pruned); `ActivityService` already uses the LRU-backed `ICacheService`.
> - SEC-013 — notification cloning moves child nodes instead of re-parsing `innerHTML`.
> - SEC-015 — explicit `content_security_policy` declared in the manifest.
>
> Remaining (non-actionable / accepted): SEC-011 (OAuth client id is public by design, kept in env), SEC-014 (inline styles — cosmetic), SEC-016 (regex — assessed not ReDoS-vulnerable), SEC-017 (3s polling — minor perf). **No critical or high severity items remain open.**

---

## Critical Findings

### SEC-001: XSS via innerHTML with API Data

**Severity:** CRITICAL
**Files:**
- `src/modules/notifications/services/NotificationGroupService.ts:123-161`
- `src/modules/notifications/NotificationCleanerModule.ts:306,327-329`

**Description:**
API-returned data (media titles, activity text, usernames) is injected into the DOM via `innerHTML` without sanitization. An attacker who controls an AniList media title or activity text could inject arbitrary HTML/JavaScript.

**Vulnerable Code:**
```typescript
// NotificationGroupService.ts:123
const mediaLink = `<a href="/anime/${activityData.mediaId}" class="title au-title">${activityData.mediaTitle}</a>`;
// activityData.mediaTitle comes directly from the AniList API

// NotificationGroupService.ts:161
textElement.innerHTML = `${timeHTML}<span class="au-notification-content">${newContentHTML}</span>`;

// NotificationCleanerModule.ts:327-329
textEl.innerHTML = `<span class="au-notification-content">${userLink.outerHTML} ${newActionText}</span>`;
```

**Impact:** Script execution in the context of `anilist.co`, potentially accessing OAuth tokens from localStorage.

**Remediation:**
1. Use `textContent` instead of `innerHTML` where possible
2. Create elements via `document.createElement()` and set attributes individually
3. If HTML is needed, sanitize with a function like:
```typescript
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
```

**Status:** ✅ FIXED - All 5 innerHTML locations now use `escapeHtml()` from Template.ts

---

### SEC-002: GraphQL Injection via String Interpolation

**Severity:** CRITICAL
**Files:**
- `src/modules/activity/ActivityService.ts:53`
- `src/modules/social/HoverCommentsModule.ts:164`
- `src/modules/notifications/services/NotificationFetchService.ts:82`

**Description:**
User-controlled strings (usernames) are interpolated directly into GraphQL queries without parameterization. A username containing `"` or GraphQL syntax could alter the query.

**Vulnerable Code:**
```typescript
// ActivityService.ts:53
return `s${idx}: MediaList(userName: "${p.userName}", mediaId: ${p.mediaId}) { ... }`;

// HoverCommentsModule.ts:164
return `${safeAlias}: MediaList(userName: "${username}", mediaId: ${mediaId}) { notes }`;
```

**Impact:** Query manipulation, potential data exfiltration from other users' data.

**Remediation:**
Use GraphQL variables instead of string interpolation. For alias batching patterns where variables aren't natively supported, escape special characters:
```typescript
function escapeGraphQLString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
```

**Status:** ✅ FIXED (HoverCommentsModule.ts, ActivityService.ts) - See BUG-001 fixes
**Status:** ⚠️ OPEN (SocialService.ts) - See SEC-018

---

### SEC-003: OAuth Token Stored in Multiple localStorage Keys

**Severity:** CRITICAL
**Files:**
- `src/api/AnilistClient.ts:111-118`
- `src/core/auth/AuthTokenService.ts`

**Description:**
`AnilistClient.setAccessToken()` saves the OAuth token to **6 different localStorage keys**, including generic names like `'token'`, `'jwt'`, and `'access_token'`. These keys could:
1. Be read by any other script on `anilist.co` (XSS -> token theft)
2. Collide with other extensions or AniList's own storage
3. Persist after the user intends to log out (if not all keys are cleaned)

**Impact:** Token exposure to other scripts, namespace pollution, inconsistent logout.

**Remediation:**
1. Store token in a **single** key (`anilist_ultimate_v2_access_token`)
2. Remove the `setAccessToken()` method from `AnilistClient` - use `AuthTokenService` exclusively
3. Use `chrome.storage.local` instead of `localStorage` for token storage (not accessible to page scripts)

**Status:** ✅ FIXED - Dual token management removed (BUG-001)

---

### SEC-018: GraphQL Injection in SocialService.ts (MediaId Interpolation)

**Severity:** CRITICAL
**File:** `src/modules/social/SocialService.ts:82`
**Source:** Manual code review (Gemini)

**Description:**
Il metodo che recupera i MediaList per gli anime degli amici usa interpolazione diretta di `mediaId` nella query GraphQL:
```typescript
const aliases = chunk.map(id =>
  `m${id}: Page(page: 1, perPage: 50) {
    mediaList(mediaId: ${id}, type: ANIME) { ... }
  }`
);
const query = `query { ${aliases.join('\n')} }`;
```

Anche se `mediaId` proviene tipicamente da elementi DOM numerici, un attacco DOM manipulation potrebbe iniettare valori non numerici o GraphQL syntax. Esempio:
```
mediaId = "123) { Viewer { id name } } evil: MediaList(mediaId: 1"
```

**Impatto:**
- Query manipulation
- Potenziale lettura di dati del Viewer non autorizzati
- Denial of service se la query iniettata è complessa

**Remediation:**
Usare variabili GraphQL invece di interpolazione diretta:
```typescript
const varDecls = chunk.map((_, i) => `$m${i}: Int!`).join(', ');
const aliases = chunk.map((_, i) =>
  `m${i}: Page(page: 1, perPage: 50) {
    mediaList(mediaId: $m${i}, type: ANIME) { ... }
  }`
);
const query = `query (${varDecls}) { ${aliases.join('\n')} }`;
const variables: Record<string, number> = {};
chunk.forEach((id, i) => { variables[`m${i}`] = Number(id); });
```

**Status:** ⚠️ OPEN

---

## High Findings

### SEC-004: Duplicate Token Management Systems

**Severity:** HIGH
**Files:**
- `src/api/AnilistClient.ts:57-101` (loadAccessToken)
- `src/core/auth/AuthTokenService.ts` (getToken, setToken)

**Description:**
Two independent systems manage the OAuth token:
1. `AuthTokenService` - DI-injected service with migration and cleanup
2. `AnilistClient.loadAccessToken()` - Constructor-time token loading with same legacy keys

These systems don't communicate. `AnilistClient` loads the token in its constructor, bypassing `AuthTokenService` entirely. If `AuthTokenService` cleans up legacy keys, `AnilistClient` won't find the token on next construction.

**Remediation:**
`AnilistClient` should inject and use `AuthTokenService`:
```typescript
constructor(
  @inject(TOKENS.AuthTokenService) private authService: AuthTokenService,
  @inject(TOKENS.ErrorHandler) private errorHandler: IErrorHandler
) {
  this.accessToken = this.authService.getToken();
  // ...
}
```

**Status:** ✅ FIXED - AnilistClient now uses AuthTokenService exclusively

---

### SEC-005: Third-Party CDN Dependency at Runtime

**Severity:** HIGH
**File:** `src/main.ts:113`

**Description:**
Font Awesome is loaded from `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css` at runtime. This introduces:
1. **Supply chain risk** - CDN compromise could inject malicious CSS/fonts
2. **Privacy concern** - CDN receives user's IP for every page load
3. **Availability risk** - CDN outage breaks all icons

**Remediation:**
Bundle Font Awesome locally:
```bash
npm install @fortawesome/fontawesome-free
```
Then import in main.ts:
```typescript
import '@fortawesome/fontawesome-free/css/all.min.css';
```

---

### SEC-006: Global History API Monkey-Patching

**Severity:** HIGH
**File:** `src/core/navigation/NavigationService.ts:117-129`

**Description:**
`NavigationService.interceptHistoryMethods()` globally replaces `history.pushState` and `history.replaceState`. This is:
1. Irreversible (no way to restore originals on extension unload)
2. Could conflict with AniList's Vue Router or other extensions
3. A content script modifying global APIs violates the principle of least privilege

**Remediation:**
Consider using `window.addEventListener('popstate')` combined with a less intrusive polling mechanism, or only intercept when needed:
```typescript
// Store originals for potential restoration
private originalPushState = history.pushState.bind(history);
private originalReplaceState = history.replaceState.bind(history);

public stop(): void {
  history.pushState = this.originalPushState;
  history.replaceState = this.originalReplaceState;
}
```

---

### SEC-007: No Input Validation on Astra Import

**Severity:** HIGH
**File:** `src/modules/astra/AstraService.ts:466-480`

**Description:**
`importJSON()` parses arbitrary JSON and writes it directly to storage. Only checks if `data.works` is an array. No validation of individual work objects, section structures, or data types. A malformed import could corrupt the entire Astra data store.

**Remediation:**
Add schema validation:
```typescript
async importJSON(jsonStr: string): Promise<boolean> {
  const data = JSON.parse(jsonStr);
  if (!data.works || !Array.isArray(data.works)) return false;

  // Validate each work
  for (const work of data.works) {
    if (!work.mediaId || typeof work.mediaId !== 'number') return false;
    if (!work.title || typeof work.title !== 'string') return false;
    // ... validate other required fields
  }

  // ... proceed with import
}
```

---

## Medium Findings

### SEC-008: Debug Mode Always Enabled

**Severity:** MEDIUM
**File:** `src/core/constants.ts:200`

**Description:**
`DEBUG.ENABLED = true` is hardcoded. While Terser strips `console.log/debug/info` in production, the `DEBUG.ENABLED` flag itself remains true and could be checked by other code paths.

**Remediation:**
Use Vite's define plugin:
```typescript
// vite.config.ts
define: {
  'import.meta.env.DEBUG': JSON.stringify(false)
}
```

---

### SEC-009: Error Handler Exposes Internal State

**Severity:** MEDIUM
**File:** `src/core/errors/ErrorHandler.ts:165-180`

**Description:**
`getStats()` returns the full error history including stack traces. Combined with the `window.AnilistUltimate` debug object, any script on the page can access error details.

**Remediation:**
Either remove the debug exposure in production or sanitize error details.

---

### SEC-010: Unbounded Memory Growth in Caches

**Severity:** MEDIUM
**Files:**
- `src/modules/activity/ActivityService.ts:22` - `scoreCache: Map` with no eviction
- `src/modules/social/SocialService.ts:16` - `friendCache: Map` with daily invalidation but no size limit
- `src/modules/social/HoverCommentsModule.ts:127` - `notesCache: Record` with no eviction

**Description:**
In-memory caches grow indefinitely during a browsing session. A user browsing many anime pages could accumulate thousands of cache entries.

**Remediation:**
Implement LRU cache or max-size limits:
```typescript
private readonly MAX_CACHE_SIZE = 500;

private evictOldest(): void {
  if (this.cache.size > this.MAX_CACHE_SIZE) {
    const firstKey = this.cache.keys().next().value;
    this.cache.delete(firstKey);
  }
}
```

---

### SEC-011: OAuth Client ID Hardcoded

**Severity:** MEDIUM
**File:** `src/core/constants.ts:45`

**Description:**
`CLIENT_ID: '17661'` is hardcoded. While OAuth client IDs are public by design (implicit grant flow), hardcoding makes rotation impossible without a new extension version.

**Remediation:**
Consider storing in config or making configurable for development.

---

### SEC-012: window.AnilistUltimate Debug Object

**Severity:** MEDIUM
**File:** `src/main.ts:34`

**Description:**
`(window as any).AnilistUltimate` exposes internal objects (config, registry, modules) to any script on the page. This is useful for debugging but should not be in production.

**Remediation:**
Gate behind debug flag:
```typescript
if (import.meta.env.DEV) {
  (window as any).AnilistUltimate = { ... };
}
```

---

### SEC-013: Notification Clone Uses innerHTML

**Severity:** MEDIUM
**File:** `src/modules/notifications/NotificationCleanerModule.ts:371-376`

**Description:**
When cloning notifications for the dropdown, `<a>` tag elements are converted to `<div>` using `clone.innerHTML = notif.innerHTML`. This re-parses the HTML and could execute inline event handlers.

**Remediation:**
Use `cloneNode(true)` consistently:
```typescript
const clone = notif.cloneNode(true) as HTMLElement;
```

---

## Low Findings

### SEC-014: CSS Styles Contain Inline Styles

**Severity:** LOW
**Files:** Multiple notification and filter components

**Description:**
Several components set styles via `element.style.cssText` with inline CSS strings. While not a direct security issue, inline styles can override CSP policies and make the extension harder to audit.

---

### SEC-015: No Content Security Policy

**Severity:** LOW
**File:** `public/manifest.json`

**Description:**
The manifest does not declare a `content_security_policy`. While MV3 has strong defaults, explicitly declaring one adds defense-in-depth.

---

### SEC-016: Regex DoS Potential

**Severity:** LOW
**Files:** Various regex patterns for URL matching

**Description:**
Several regex patterns like `/\/(anime|manga)\/(\d+)/` are simple and not vulnerable to ReDoS. However, patterns should be reviewed as complexity grows.

---

### SEC-017: Timer-Based Polling

**Severity:** LOW
**File:** `src/modules/social/HoverCommentsModule.ts:69`

**Description:**
3-second polling interval (`setInterval`) runs continuously on media pages. While not a security issue, it creates unnecessary CPU usage.

---

## Recommendations Summary

| Priority | Action | Status |
|----------|--------|--------|
| P0 | ~~Fix innerHTML XSS (SEC-001)~~ | ✅ FIXED |
| P0 | ~~Fix GraphQL injection in ActivityService/HoverComments (SEC-002)~~ | ✅ FIXED |
| P0 | ~~Fix GraphQL injection in SocialService (SEC-018)~~ | ✅ FIXED |
| P0 | ~~Consolidate token management (SEC-003, SEC-004)~~ | ✅ FIXED |
| P1 | ~~Bundle Font Awesome locally (SEC-005)~~ | ✅ FIXED |
| P1 | ~~Store history.pushState originals for cleanup (SEC-006)~~ | ✅ FIXED |
| P1 | ~~Add schema validation to Astra import (SEC-007)~~ | ✅ FIXED |
| P2 | ~~Disable debug in production (SEC-008, SEC-012)~~ | ✅ FIXED |
| P2 | ~~Add cache size limits (SEC-010)~~ | ✅ FIXED |
| P2 | ~~Add CSP to manifest (SEC-015)~~ | ✅ FIXED |
