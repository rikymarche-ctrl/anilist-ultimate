import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';
import { resolve } from 'path';

export default defineConfig({
  // Relative base so emitted CSS/asset URLs (e.g. Font Awesome woff2) resolve
  // against chrome-extension://<id>/ instead of the host page's origin
  // when injected by a content script.
  base: '',
  plugins: [crx({ manifest, contentScripts: { standaloneFiles: ['src/native-list-editor.ts'] } })],
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
    // Chrome 88, so a modern target leaves the selector intact.
    cssTarget: 'chrome120',
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
});
