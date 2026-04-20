// vite.config.ts
import { defineConfig } from "file:///C:/Users/ricca/Documenti/Anilist/anilist-ultimate-v2/node_modules/vite/dist/node/index.js";
import { crx } from "file:///C:/Users/ricca/Documenti/Anilist/anilist-ultimate-v2/node_modules/@crxjs/vite-plugin/dist/index.mjs";

// public/manifest.json
var manifest_default = {
  manifest_version: 3,
  name: "Anilist Ultimate",
  version: "2.0.0",
  description: "The ultimate Anilist extension suite. Modern calendar, hover comments, and more.",
  author: "ExAstra",
  homepage_url: "https://github.com/rikymarche-ctrl/anilist-ultimate",
  permissions: ["storage"],
  host_permissions: [
    "https://anilist.co/*",
    "https://graphql.anilist.co/*"
  ],
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  action: {
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    default_title: "Anilist Ultimate",
    default_popup: "popup.html"
  },
  content_scripts: [
    {
      matches: ["https://anilist.co/*"],
      js: ["src/main.ts"],
      css: ["src/styles/main.css", "src/styles/calendar.css", "src/styles/settings-panel.css"],
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: [
    {
      resources: ["icons/*", "assets/*", "src/styles/*.css"],
      matches: ["https://anilist.co/*"]
    }
  ]
};

// vite.config.ts
import { resolve } from "path";
var __vite_injected_original_dirname = "C:\\Users\\ricca\\Documenti\\Anilist\\anilist-ultimate-v2";
var vite_config_default = defineConfig({
  plugins: [crx({ manifest: manifest_default })],
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "src"),
      "@core": resolve(__vite_injected_original_dirname, "src/core"),
      "@modules": resolve(__vite_injected_original_dirname, "src/modules"),
      "@ui": resolve(__vite_injected_original_dirname, "src/ui")
    }
  },
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]"
      }
    },
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: false,
        // Keep console for debugging
        drop_debugger: true
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiLCAicHVibGljL21hbmlmZXN0Lmpzb24iXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxyaWNjYVxcXFxEb2N1bWVudGlcXFxcQW5pbGlzdFxcXFxhbmlsaXN0LXVsdGltYXRlLXYyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxyaWNjYVxcXFxEb2N1bWVudGlcXFxcQW5pbGlzdFxcXFxhbmlsaXN0LXVsdGltYXRlLXYyXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9DOi9Vc2Vycy9yaWNjYS9Eb2N1bWVudGkvQW5pbGlzdC9hbmlsaXN0LXVsdGltYXRlLXYyL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCB7IGNyeCB9IGZyb20gJ0Bjcnhqcy92aXRlLXBsdWdpbic7XHJcbmltcG9ydCBtYW5pZmVzdCBmcm9tICcuL3B1YmxpYy9tYW5pZmVzdC5qc29uJztcclxuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gJ3BhdGgnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICBwbHVnaW5zOiBbY3J4KHsgbWFuaWZlc3QgfSldLFxyXG4gIHJlc29sdmU6IHtcclxuICAgIGFsaWFzOiB7XHJcbiAgICAgICdAJzogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMnKSxcclxuICAgICAgJ0Bjb3JlJzogcmVzb2x2ZShfX2Rpcm5hbWUsICdzcmMvY29yZScpLFxyXG4gICAgICAnQG1vZHVsZXMnOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy9tb2R1bGVzJyksXHJcbiAgICAgICdAdWknOiByZXNvbHZlKF9fZGlybmFtZSwgJ3NyYy91aScpLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIGJ1aWxkOiB7XHJcbiAgICByb2xsdXBPcHRpb25zOiB7XHJcbiAgICAgIG91dHB1dDoge1xyXG4gICAgICAgIGNodW5rRmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxyXG4gICAgICAgIGVudHJ5RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxyXG4gICAgICAgIGFzc2V0RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uW2V4dF0nLFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICAgIG1pbmlmeTogJ3RlcnNlcicsXHJcbiAgICB0ZXJzZXJPcHRpb25zOiB7XHJcbiAgICAgIGNvbXByZXNzOiB7XHJcbiAgICAgICAgZHJvcF9jb25zb2xlOiBmYWxzZSwgLy8gS2VlcCBjb25zb2xlIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgICBkcm9wX2RlYnVnZ2VyOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgfSxcclxuICB9LFxyXG4gIHNlcnZlcjoge1xyXG4gICAgcG9ydDogNTE3MyxcclxuICAgIHN0cmljdFBvcnQ6IHRydWUsXHJcbiAgICBobXI6IHtcclxuICAgICAgcG9ydDogNTE3MyxcclxuICAgIH0sXHJcbiAgfSxcclxufSk7XHJcbiIsICJ7XHJcbiAgXCJtYW5pZmVzdF92ZXJzaW9uXCI6IDMsXHJcbiAgXCJuYW1lXCI6IFwiQW5pbGlzdCBVbHRpbWF0ZVwiLFxyXG4gIFwidmVyc2lvblwiOiBcIjIuMC4wXCIsXHJcbiAgXCJkZXNjcmlwdGlvblwiOiBcIlRoZSB1bHRpbWF0ZSBBbmlsaXN0IGV4dGVuc2lvbiBzdWl0ZS4gTW9kZXJuIGNhbGVuZGFyLCBob3ZlciBjb21tZW50cywgYW5kIG1vcmUuXCIsXHJcbiAgXCJhdXRob3JcIjogXCJFeEFzdHJhXCIsXHJcbiAgXCJob21lcGFnZV91cmxcIjogXCJodHRwczovL2dpdGh1Yi5jb20vcmlreW1hcmNoZS1jdHJsL2FuaWxpc3QtdWx0aW1hdGVcIixcclxuICBcInBlcm1pc3Npb25zXCI6IFtcInN0b3JhZ2VcIl0sXHJcbiAgXCJob3N0X3Blcm1pc3Npb25zXCI6IFtcclxuICAgIFwiaHR0cHM6Ly9hbmlsaXN0LmNvLypcIixcclxuICAgIFwiaHR0cHM6Ly9ncmFwaHFsLmFuaWxpc3QuY28vKlwiXHJcbiAgXSxcclxuICBcImljb25zXCI6IHtcclxuICAgIFwiMTZcIjogXCJpY29ucy9pY29uMTYucG5nXCIsXHJcbiAgICBcIjQ4XCI6IFwiaWNvbnMvaWNvbjQ4LnBuZ1wiLFxyXG4gICAgXCIxMjhcIjogXCJpY29ucy9pY29uMTI4LnBuZ1wiXHJcbiAgfSxcclxuICBcImFjdGlvblwiOiB7XHJcbiAgICBcImRlZmF1bHRfaWNvblwiOiB7XHJcbiAgICAgIFwiMTZcIjogXCJpY29ucy9pY29uMTYucG5nXCIsXHJcbiAgICAgIFwiNDhcIjogXCJpY29ucy9pY29uNDgucG5nXCIsXHJcbiAgICAgIFwiMTI4XCI6IFwiaWNvbnMvaWNvbjEyOC5wbmdcIlxyXG4gICAgfSxcclxuICAgIFwiZGVmYXVsdF90aXRsZVwiOiBcIkFuaWxpc3QgVWx0aW1hdGVcIixcclxuICAgIFwiZGVmYXVsdF9wb3B1cFwiOiBcInBvcHVwLmh0bWxcIlxyXG4gIH0sXHJcbiAgXCJjb250ZW50X3NjcmlwdHNcIjogW1xyXG4gICAge1xyXG4gICAgICBcIm1hdGNoZXNcIjogW1wiaHR0cHM6Ly9hbmlsaXN0LmNvLypcIl0sXHJcbiAgICAgIFwianNcIjogW1wic3JjL21haW4udHNcIl0sXHJcbiAgICAgIFwiY3NzXCI6IFtcInNyYy9zdHlsZXMvbWFpbi5jc3NcIiwgXCJzcmMvc3R5bGVzL2NhbGVuZGFyLmNzc1wiLCBcInNyYy9zdHlsZXMvc2V0dGluZ3MtcGFuZWwuY3NzXCJdLFxyXG4gICAgICBcInJ1bl9hdFwiOiBcImRvY3VtZW50X2lkbGVcIlxyXG4gICAgfVxyXG4gIF0sXHJcbiAgXCJ3ZWJfYWNjZXNzaWJsZV9yZXNvdXJjZXNcIjogW1xyXG4gICAge1xyXG4gICAgICBcInJlc291cmNlc1wiOiBbXCJpY29ucy8qXCIsIFwiYXNzZXRzLypcIiwgXCJzcmMvc3R5bGVzLyouY3NzXCJdLFxyXG4gICAgICBcIm1hdGNoZXNcIjogW1wiaHR0cHM6Ly9hbmlsaXN0LmNvLypcIl1cclxuICAgIH1cclxuICBdXHJcbn1cclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUEwVixTQUFTLG9CQUFvQjtBQUN2WCxTQUFTLFdBQVc7OztBQ0RwQjtBQUFBLEVBQ0Usa0JBQW9CO0FBQUEsRUFDcEIsTUFBUTtBQUFBLEVBQ1IsU0FBVztBQUFBLEVBQ1gsYUFBZTtBQUFBLEVBQ2YsUUFBVTtBQUFBLEVBQ1YsY0FBZ0I7QUFBQSxFQUNoQixhQUFlLENBQUMsU0FBUztBQUFBLEVBQ3pCLGtCQUFvQjtBQUFBLElBQ2xCO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxFQUNUO0FBQUEsRUFDQSxRQUFVO0FBQUEsSUFDUixjQUFnQjtBQUFBLE1BQ2QsTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBLE1BQ04sT0FBTztBQUFBLElBQ1Q7QUFBQSxJQUNBLGVBQWlCO0FBQUEsSUFDakIsZUFBaUI7QUFBQSxFQUNuQjtBQUFBLEVBQ0EsaUJBQW1CO0FBQUEsSUFDakI7QUFBQSxNQUNFLFNBQVcsQ0FBQyxzQkFBc0I7QUFBQSxNQUNsQyxJQUFNLENBQUMsYUFBYTtBQUFBLE1BQ3BCLEtBQU8sQ0FBQyx1QkFBdUIsMkJBQTJCLCtCQUErQjtBQUFBLE1BQ3pGLFFBQVU7QUFBQSxJQUNaO0FBQUEsRUFDRjtBQUFBLEVBQ0EsMEJBQTRCO0FBQUEsSUFDMUI7QUFBQSxNQUNFLFdBQWEsQ0FBQyxXQUFXLFlBQVksa0JBQWtCO0FBQUEsTUFDdkQsU0FBVyxDQUFDLHNCQUFzQjtBQUFBLElBQ3BDO0FBQUEsRUFDRjtBQUNGOzs7QURyQ0EsU0FBUyxlQUFlO0FBSHhCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMkJBQVMsQ0FBQyxDQUFDO0FBQUEsRUFDM0IsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxRQUFRLGtDQUFXLEtBQUs7QUFBQSxNQUM3QixTQUFTLFFBQVEsa0NBQVcsVUFBVTtBQUFBLE1BQ3RDLFlBQVksUUFBUSxrQ0FBVyxhQUFhO0FBQUEsTUFDNUMsT0FBTyxRQUFRLGtDQUFXLFFBQVE7QUFBQSxJQUNwQztBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsSUFDRjtBQUFBLElBQ0EsUUFBUTtBQUFBLElBQ1IsZUFBZTtBQUFBLE1BQ2IsVUFBVTtBQUFBLFFBQ1IsY0FBYztBQUFBO0FBQUEsUUFDZCxlQUFlO0FBQUEsTUFDakI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sWUFBWTtBQUFBLElBQ1osS0FBSztBQUFBLE1BQ0gsTUFBTTtBQUFBLElBQ1I7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
