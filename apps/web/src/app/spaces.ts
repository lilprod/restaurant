import {
  accountApi, ApiClient, authApi, localStorageTokenStorage, memoryTokenStorage, platformApi, publicApi, tenantApi,
} from "@restaurant/api-client";

/** Préfixe de l'API : proxy Vite en développement, ou URL absolue via VITE_API_URL. */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1").replace(/\/$/, "");

/** Clés de stockage distinctes : les deux espaces ont des sessions indépendantes. */
export const STORAGE_KEYS = {
  platformRefresh: "restaurant.platform.refresh",
  tenantRefresh: (slug: string) => `restaurant.tenant.${slug}.refresh`,
  tenantLicense: (slug: string) => `restaurant.tenant.${slug}.license`,
};

function makeSpace(client: ApiClient) {
  return { client, auth: authApi(client), account: accountApi(client) };
}

const platformClient = new ApiClient({ baseUrl: API_BASE, space: "platform", storage: localStorageTokenStorage(STORAGE_KEYS.platformRefresh) });
export const platformSpace = { ...makeSpace(platformClient), api: platformApi(platformClient) };
export type PlatformSpace = typeof platformSpace;

const tenantSpaces = new Map<string, ReturnType<typeof makeTenantSpace>>();
function makeTenantSpace(slug: string) {
  const client = new ApiClient({ baseUrl: API_BASE, space: "tenant", storage: localStorageTokenStorage(STORAGE_KEYS.tenantRefresh(slug)) });
  return { ...makeSpace(client), api: tenantApi(client), slug };
}
/** Un client par restaurant (une session par sous-domaine). */
export function getTenantSpace(slug: string) {
  let s = tenantSpaces.get(slug);
  if (!s) { s = makeTenantSpace(slug); tenantSpaces.set(slug, s); }
  return s;
}
export type TenantSpace = ReturnType<typeof makeTenantSpace>;

export const publicSpace = publicApi(new ApiClient({ baseUrl: API_BASE, space: "platform", storage: memoryTokenStorage() }));
