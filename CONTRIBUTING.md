# Contributing

Bug reports, focused fixes and documentation improvements are welcome. Read the [user guide](docs/USER_GUIDE.md), [architecture](docs/ARCHITECTURE.md) and [security reporting policy](SECURITY.md) first.

## Local setup

Use Node.js 22.13.0 or later and npm.

```sh
git clone https://github.com/rikymarche-ctrl/anilist-ultimate.git
cd anilist-ultimate
npm ci
npm run build
```

Load `dist/` in a separate Chromium profile. See [installation](docs/INSTALLATION.md) and [OAuth setup](OAUTH_SETUP.md). Never commit a token, a private backup, a browser profile or a developer client secret. Variables beginning with `VITE_` are compiled into client code and must not contain secrets.

## Making a change

Keep changes focused. Follow the existing TypeScript, dependency-injection, EventBus and module lifecycle patterns. Production modules should stay below 800 lines; extract coherent units rather than splitting solely by line count.

Account/session guards and storage/auth initialization order are functional requirements. Clean up owned listeners, observers, timers and requests when a view/module retires. A child container must not dispose services owned by its parent.

Use the escaping template/DOM utilities and URL validation helpers. Validate unknown API/storage data before using it. Do not add a second authenticated API client or a new durable writer that bypasses the background boundary.

For a refactor, preserve public APIs, rendered behavior, event wiring and lifecycle guards. Make behavior fixes separate when possible.

## Checks

```sh
npm run typecheck
npm run lint
npm exec vitest run path/to/affected.test.ts
npm run check
npm run check:coverage
```

The check script runs legacy-contract checks, icon inventory validation, TypeScript, ESLint, tests, production build and package-resource validation. The coverage variant also gathers coverage. A passing run is evidence for that checkout, not a claim about every AniList integration path.

`npm run smoke:mv3` requires a Chromium runtime supporting unpacked extensions. Details and optional fixture flags are in [testing](docs/TESTING.md). For UI changes, inspect the actual states and narrow layouts. Update docs when a flow or limitation changes.

The broad `npm run format` command rewrites source files; avoid unrelated formatting in a focused contribution.

## Pull requests

Describe the problem, resulting behavior and validation. Link related issues, explain any remaining limitations, and include redacted screenshots for visible changes. Do not mark real-account tests complete when only synthetic fixtures ran.

Review changed files for credentials and private data before pushing. Do not mix generated builds, release ZIPs or local audit logs into source changes.

Project contributions follow the existing [GPL-3.0](LICENSE) license; third-party assets keep their [own notices](THIRD_PARTY_NOTICES.md).
