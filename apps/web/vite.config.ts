/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

/**
 * Les paquets partagés sont compilés en CommonJS (`dist/`) pour l'API NestJS. Côté web, on les consomme
 * directement depuis leurs sources TypeScript (paquets « juste-à-temps » au sens de Turborepo) : Vite les
 * transpile en ESM, le tree-shaking fonctionne et le HMR suit les modifications sans rebuild.
 * Les mêmes chemins sont déclarés dans `tsconfig.json` (paths) pour la vérification de types.
 */
const workspaceAliases = {
  "@restaurant/api-client": pkg("api-client"),
  "@restaurant/shared-types": pkg("shared-types"),
  "@restaurant/ui-tokens": pkg("ui-tokens"),
  "@restaurant/utils": pkg("utils"),
  "@restaurant/validation": pkg("validation"),
};

const API_TARGET = process.env.VITE_API_PROXY ?? "http://localhost:3000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // X5 : PWA (installation sur tablette, application hors ligne). Service worker écrit à la main (src/sw.ts, `injectManifest`) :
    // il ne met en cache que des fichiers statiques, jamais l'API. Enregistrement par un script du même domaine (CSP `script-src 'self'`).
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Gestion Restaurant",
        short_name: "Restaurant",
        description: "Prise de commande, cuisine et caisse, même en cas de coupure réseau.",
        lang: "fr",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "any",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        // Shell : page, scripts, styles, icônes et polices de base (Geist, latin). Les autres polices de marque et les
        // images de la carte sont mises en cache à la demande par le service worker.
        globPatterns: ["index.html", "theme-init.js", "favicon.svg", "icons/*.png", "assets/*.{js,css}", "assets/geist-*latin-wght-normal*.woff2", "assets/geist-mono-*latin-wght-normal*.woff2"],
        globIgnores: ["**/*.map"],
        rollupFormat: "iife",
        maximumFileSizeToCacheInBytes: 2_500_000,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { ...workspaceAliases, "@": fileURLToPath(new URL("./src", import.meta.url)) },
    dedupe: ["zod", "react", "react-dom"],
  },
  server: {
    port: 5173,
    host: true,
    // Même origine en développement : pas de CORS, les URL d'images `/uploads/...` passent aussi par le proxy.
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: false },
      "/uploads": { target: API_TARGET, changeOrigin: false },
      // Temps réel (Socket.io, espace de noms /realtime) : WebSocket relayé vers l'API.
      "/socket.io": { target: API_TARGET, ws: true, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": { target: API_TARGET },
      "/uploads": { target: API_TARGET },
      "/socket.io": { target: API_TARGET, ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    // Polices jamais incorporées en `data:` : la CSP de production (`font-src 'self'`) les bloquerait.
    assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        // Bibliothèques stables dans des fichiers séparés : mises en cache entre deux déploiements.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules)/.exec(id)?.[1] ?? "";
          if (/^(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)$/.test(pkg)) return "react";
          if (/^(recharts|d3-.*|victory-vendor|@reduxjs\/toolkit|redux|immer|reselect|es-toolkit|decimal\.js-light)$/.test(pkg)) return "charts";
          if (/^(motion|framer-motion|motion-dom|motion-utils)$/.test(pkg)) return "motion";
          if (/^(zod|react-hook-form|@hookform\/resolvers)$/.test(pkg)) return "forms-vendor";
          if (/^(@radix-ui\/.*|radix-ui|@floating-ui\/.*|cmdk|react-remove-scroll.*|aria-hidden|use-sidecar|tslib|react-style-singleton|use-callback-ref|get-nonce|detect-node-es)$/.test(pkg)) return "ui";
          if (/^(@tanstack\/.*)$/.test(pkg)) return "query";
          if (/^(socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io\/.*|xmlhttprequest-ssl|debug|ms)$/.test(pkg)) return "realtime";
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
