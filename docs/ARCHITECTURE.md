# Architecture

## Browser contexts

| Context                       | Entry                      | Responsibility                                                                            |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| Manifest V3 background worker | `src/background.ts`        | Authentication, authenticated API transport, message routing, durable writers and alarms. |
| AniList content script        | `src/main.ts`              | SPA navigation, enabled feature modules, site DOM and foreground clients.                 |
| Popup                         | `src/popup/popup.ts`       | Login/logout and entry points using extension messages.                                   |
| Settings page                 | `src/settings/settings.ts` | Preferences and explicit account-bound recovery.                                          |

`public/manifest.json` declares permissions, content matches and resources. Vite and CRXJS compile source entries into `dist/`; popup/settings and content scripts execute in different contexts.

## Composition and lifetime

`src/setup.ts` remains the shared composition root used by background and content contexts. It selects implementations through the background/foreground branch. UI imports can still participate in a shared setup chunk.

Registration and resolution order matter. Document-owned services must be resolved in the owner container before child scopes borrow them; storage restrictions and authentication/configuration barriers must complete before account-sensitive work starts. Preserve the order documented in `setup.ts` when refactoring.

The background router waits for initialization before resolving services. Foreground views and modules own their listeners, timers, observers and cancellation/version state; disposing a child does not transfer ownership of shared services.

## API and messages

Foreground requests use the API proxy and fixed runtime message contracts in `src/shared/`. The background validates message senders, session context and allowed commands. Raw content-script access to credentials is not the intended path.

`AnilistClient` manages authenticated requests, a conservative sliding-window limit of 25 requests/minute, at least 700 ms between dispatches and at most two concurrent transports. Rate-limit backoff, typed errors and GraphQL semantic failures are handled separately. These are extension dispatch settings, not a promise about AniList's current public service quota.

`GraphQLBatcher` combines requests within query budgets and isolates supported partial failures. Provider payloads cross validation boundaries before reaching domain code. Other public metadata providers use separate feature services.

## Data and writers

- Settings/preferences use Chrome sync storage through configuration clients and the background configuration writer.
- Astra workspaces use current account/local namespaces and validated summary/work/backup structures.
- Pending AniList edits are durable, versioned and bound to their original account. The queue checks revisions/session context and preserves unconfirmed work.
- Notes replacement checks the exact remote baseline before writing. This is optimistic conflict detection, not a server-side transaction.
- Custom friend lists and Friend Alerts use account scopes. The alert host is the sole writer of the alert inbox/subscriptions.
- The general local-storage bridge exposes a fixed set of allowed data; auth and private host-owned records are not arbitrary keys clients can read/write.

Astra backup import is distinct from AniList list import and from pending-edit recovery. [Data and backups](DATA_AND_BACKUPS.md).

## Modules and SPA navigation

Modules extend the shared module infrastructure, declare page matching and respond to configuration/auth/navigation changes. Modules retire pending work when the relevant page/account/lifetime changes. Shared observers reduce repeated scans; views clean up only DOM they own.

Epochs, request versions and captured API contexts prevent late responses from updating a retired view or another account. A request already accepted by a writer may finish for its original account; hiding a view is not cancellation of a remote mutation.

See the [module map](MODULES.md) for entry points.

## Wrapped

The yearly recap separates provider loading/validation, pure report calculations, story slides and PNG rendering. The seasonal recap separately models broadcast attribution and persistent awards. They share story navigation, chart and liquid-background utilities.

Yearly totals currently come from AniList list activities, not a replay of the local Journal. [Astra Wrapped](ASTRA_WRAPPED.md) · [Seasonal Wrapped](SEASONAL_WRAPPED.md).
