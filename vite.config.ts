import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["favicon.ico", "favicon.png", "icon.png", "logo.png"],
      manifest: {
        name: "Starlink Jewels",
        short_name: "Starlink",
        description: "Starlink Jewels — B2B Diamond Jewelry Order Management",
        theme_color: "#2F5DAA",
        background_color: "#F7F9FC",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
          { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        // Firebase SDK grows the main chunk past the default 2 MiB precache
        // limit — raise it so the service worker can still precache the app.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Cache order/CAD photos from Firebase Storage. Download URLs are unique
        // per file token, so CacheFirst never serves a stale image — once loaded,
        // it's served instantly (even offline) on every later view/scroll.
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname.includes("firebasestorage") ||
              url.hostname.endsWith(".firebasestorage.app"),
            handler: "CacheFirst",
            options: {
              cacheName: "sl-firebase-images",
              expiration: {
                maxEntries: 600,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(process.cwd(), "src") },
  },
  server: { host: "::", port: 8080, strictPort: true },
  preview: { host: "::", port: 8080, strictPort: true },
});
