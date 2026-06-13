import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';
import { resolve } from 'path';

export default defineConfig({
  // Relative base so emitted CSS/asset URLs (e.g. Font Awesome woff2) resolve
  // against chrome-extension://<id>/ instead of the host page's origin
  // when injected by a content script.
  base: '',
  plugins: [crx({ manifest })],
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
    rollupOptions: {
      output: {
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    minify: 'terser',
    // esbuild's CSS minifier corrupts the Font Awesome `--fa` custom-property
    // glyph escapes (Private Use Area codepoints) - some become empty strings,
    // others become raw multi-byte UTF-8. Keep CSS unminified to preserve them.
    cssMinify: false,
    terserOptions: {
      compress: {
        drop_console: false, // TEMPORANEO: mantengo i log per debug
        drop_debugger: false,
        // pure_funcs: ['console.log', 'console.debug', 'console.info'],
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
      reporter: ['text', 'json', 'html'],
    },
  },
});
