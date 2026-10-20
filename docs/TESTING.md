# Testing

Use Node.js 22.13.0 or later and install the lockfile dependencies with `npm ci`.

## Checks

```sh
npm run typecheck
npm run lint
npm exec vitest run path/to/affected.test.ts
npm run check
npm run check:coverage
```

The complete check runs runtime-contract checks, the icon inventory, TypeScript, ESLint, Vitest, a production build and package-resource validation. The coverage variant gathers V8 coverage. `npm test` starts the interactive runner; use `run` for a bounded invocation.

## Browser checks

Build first, then run `npm run smoke:mv3`. The script launches an isolated signed-out Chromium profile. Its default executable is `.cache/mv3-runtime/chrome-win64/chrome.exe`; set `MV3_BROWSER` to a compatible Chromium binary if needed.

Additional fixtures are selected explicitly:

```sh
node scripts/smoke-mv3.mjs --templates --calendar --scores --following
node scripts/smoke-mv3.mjs --foreground --archives
node scripts/smoke-mv3.mjs --wrapped --seasonal
```

A base MV3 pass does not run every optional fixture. Most fixture requests are blocked or simulated. The explicit `--media-live` option enables scoped public metadata requests. Outputs under `.cache/` are local and ignored.

## Review a change

Check the relevant normal, empty, pending, error and retry states, account/page changes, disposal and narrow layouts. Test real AniList integration separately from synthetic fixtures. Never attach tokens, private Notes or raw personal storage to test reports.

Rebuild when public license/notice files change and inspect the final package. Verify documentation links and instructions whenever workflows change.

[Contributing](../CONTRIBUTING.md) · [Architecture](ARCHITECTURE.md)
