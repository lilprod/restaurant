/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Préfixe de l'API (défaut : /api/v1 via le proxy Vite). */
  readonly VITE_API_URL?: string;
  /** Domaine racine pour la résolution du restaurant par sous-domaine (défaut : localhost). */
  readonly VITE_ROOT_DOMAIN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
