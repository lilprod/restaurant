/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

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
  plugins: [react(), tailwindcss()],
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
