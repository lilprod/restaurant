import { getTenantSpace } from "@/app/spaces";
import { useSession } from "@/providers/session";

/** API du restaurant courant + clés de requête préfixées par ["tenant", slug]. */
export function useTenant() {
  const session = useSession();
  const space = getTenantSpace(session.slug!);
  const role = session.user?.role ?? "";
  return {
    api: space.api,
    slug: session.slug!,
    key: (...parts: unknown[]) => [...session.queryKey, ...parts] as const,
    role,
    isAdmin: role === "ADMIN",
    canSeeLicense: role === "ADMIN" || role === "MANAGER",
  };
}

/** Sections de réglages lisibles par rôle (miroir du tableau READ de l'API). */
export const SETTINGS_READ: Record<string, string[]> = {
  business: ["ADMIN", "MANAGER"],
  branding: ["ADMIN", "MANAGER"],
  operations: ["ADMIN", "MANAGER", "WAITER", "KITCHEN"],
  localization: ["ADMIN", "MANAGER", "WAITER", "KITCHEN"],
  security: ["ADMIN"],
};
