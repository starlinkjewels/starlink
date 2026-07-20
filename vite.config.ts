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
