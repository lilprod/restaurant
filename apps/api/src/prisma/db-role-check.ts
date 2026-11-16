export interface RoleRow { rolsuper: boolean; rolbypassrls: boolean; rolname: string }
type Queryable = { $queryRaw<T = unknown>(q: TemplateStringsArray): Promise<T> };

/**
 * La RLS ne s'applique ni aux superusers ni aux rôles BYPASSRLS : si l'application se connecte avec un tel rôle,
 * l'isolation entre restaurants repose uniquement sur les filtres du code. En production on refuse de démarrer.
 * @returns le problème détecté, ou `null` si le rôle est restreint.
 */
export async function findPrivilegedRole(db: Queryable): Promise<string | null> {
  const rows = await db.$queryRaw<RoleRow[]>`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  const r = rows[0];
  if (!r) return null;
  if (r.rolsuper) return `le rôle SQL « ${r.rolname} » est superuser`;
  if (r.rolbypassrls) return `le rôle SQL « ${r.rolname} » a l'attribut BYPASSRLS`;
  return null;
}
