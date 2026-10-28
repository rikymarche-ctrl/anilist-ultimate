import { defineConfig, loadEnv } from 'vite';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';
import { resolve } from 'path';
import { createHash } from 'crypto';

/** Permanent AMO add-on ID: it also fixes the Firefox OAuth redirect host. Never change it after release. */
const FIREFOX_ADDON_ID = 'anilist-ultimate@exastra';
const CHROMIUM_CLIENT_ID = '35100';

/** Firefox's identity.getRedirectURL(): the host is the SHA-1 of the add-on ID. */
function firefoxRedirectUrl(): string {
  return `https://${createHash('sha1').update(FIREFOX_ADDON_ID).digest('hex')}.extensions.allizom.org/`;
}

/**
 * Firefox MV3 differs from the Chromium manifest in a few keys only:
 * an event page (`background.scripts`) instead of a service worker, `options_ui`,
 * the Gecko add-on ID, and no Chromium-only `key`/`minimum_chrome_version`.
 * 140 covers MAIN-world content scripts (128), storage.session (115) and
 * `data_collection_permissions`, required for new AMO listings.
 *
 * The raw `src/styles/*.css` content-script entries are dropped: they are copied
 * verbatim with `@import`s of files that are not emitted, which Chromium ignores
 * but Firefox treats as a load failure that cancels the WHOLE content script
 * (JS included). Their rules are already bundled into the CSS crxjs attaches to
 * the entry from the `import './styles/...'` statements in main.ts.
 */
function firefoxManifest(): ManifestV3Export {
  const {
    key: _key,
    minimum_chrome_version: _minimum,
    options_page,
    background,
    content_scripts,
    ...rest
  } = manifest;
  return {
    ...rest,
    content_scripts: content_scripts.map(({ css: _rawCss, ...script }) => script),
    background: { scripts: [background.service_worker], type: background.type },
    options_ui: { page: options_page, open_in_tab: true },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ADDON_ID,
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    },
  } as unknown as ManifestV3Export;
}

/**
 * The Chromium OAuth client only accepts the chromiumapp.org redirect, so a Firefox package built
 * with it cannot log in. Fail the build instead of shipping that package; AU_ALLOW_CHROMIUM_CLIENT=1
 * still allows a local build for testing everything except login.
 */
function assertFirefoxClient(mode: string): void {
  const clientId =
    loadEnv(mode, process.cwd(), 'VITE_').VITE_ANILIST_CLIENT_ID ?? CHROMIUM_CLIENT_ID;
  if (clientId !== CHROMIUM_CLIENT_ID) return;
  const message =
    '[firefox] VITE_ANILIST_CLIENT_ID is the Chromium client: AniList login cannot work in Firefox.' +
    `\n[firefox] Register an AniList client with redirect ${firefoxRedirectUrl()}` +
    '\n[firefox] and put its ID in .env.firefox.local, then rebuild.';
  if (process.env.AU_ALLOW_CHROMIUM_CLIENT !== '1') throw new Error(message);
  console.warn(
    `\n${message}\n[firefox] AU_ALLOW_CHROMIUM_CLIENT=1: building anyway, login disabled.\n`
  );
}

export default defineConfig(({ mode }) => {
  const firefox = mode === 'firefox';
  if (firefox) assertFirefoxClient(mode);
  return {
    // Relative base so emitted CSS/asset URLs (e.g. Font Awesome woff2) resolve
    // against the extension origin instead of the host page's origin
    // when injected by a content script.
    base: '',
    plugins: [
      crx({
        manifest: firefox ? firefoxManifest() : manifest,
        browser: firefox ? 'firefox' : 'chrome',
        contentScripts: { standaloneFiles: ['src/native-list-editor.ts'] },
      }),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@core': resolve(__dirname, 'src/core'),
        '@modules': resolve(__dirname, 'src/modules'),
        '@ui': resolve(__dirname, 'src/ui'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    build: {
      outDir: firefox ? 'dist-firefox' : 'dist',
      // Extension pages and content-script chunks are loaded in separate worlds.
      // Let imports load their dependencies without cross-world module preloads.
      modulePreload: false,
      rollupOptions: {
        // No content hashes: an unpacked extension keeps the manifest it loaded, so a
        // rebuild that renamed files left the old content loader and worker importing
        // deleted chunks until the extension itself was reloaded.
        output: {
          chunkFileNames: 'assets/[name].js',
          entryFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
      minify: 'terser',
      // esbuild's CSS minifier corrupts the Font Awesome `--fa` custom-property
      // glyph escapes (Private Use Area codepoints) - some become empty strings,
      // others become raw multi-byte UTF-8. Keep CSS unminified to preserve them.
      cssMinify: false,
      // This is a Chrome MV3 extension, so target modern Chrome. Without this,
      // esbuild "lowers" Font Awesome's `:is(.fa,...):before` selector for legacy
      // browsers and mangles it into `.fa):before` (stray paren), invalidating the
      // whole rule so NO icon glyph is ever emitted. `:is()` is native since
      // Chrome 88 (Firefox 78), so a modern target leaves the selector intact.
      cssTarget: firefox ? ['chrome120', 'firefox140'] : 'chrome120',
      terserOptions: {
        compress: {
          // Console output is intentionally kept: src/core/logger.ts only emits
          // debug/info/warn/success in dev builds (DEBUG.ENABLED), while error
          // logs are always emitted but pass through DiagnosticPrivacy sanitization.
          drop_console: false,
          drop_debugger: false,
          passes: 2,
        },
        format: {
          comments: false,
        },
      },
      reportCompressedSize: true,
      chunkSizeWarningLimit: 1000,
    },

    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.{test,spec}.ts', 'src/test/**', 'src/**/*.d.ts'],
        reporter: ['text-summary', 'json-summary', 'json', 'html'],
      },
    },
  };
});
