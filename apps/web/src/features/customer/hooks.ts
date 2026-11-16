import { getTenantSpace } from "@/app/spaces";
import { useSession } from "@/providers/session";

/** API de l'espace client du restaurant courant + clés de cache sous la racine de session (vidées à la déconnexion). */
export function useCustomer() {
  const session = useSession();
  const space = getTenantSpace(session.slug!);
  const root = session.queryKey;
  return { api: space.customer, slug: session.slug!, root, key: (...parts: string[]) => [...root, "customer", ...parts] as const };
}
