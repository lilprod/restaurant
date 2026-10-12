import type { Account } from "./accounts.repo";
import type { ResolvedPolicy } from "./security-policy.service";

export type Restriction = "pwd-change" | "2fa-setup";

/**
 * Restriction qui pèse sur la session d'un compte : tant qu'elle n'est pas levée, seules les routes
 * « compte » (changer le mot de passe, activer la 2FA, se déconnecter) sont accessibles.
 * Calculée depuis l'état en base à chaque requête, donc levée dès que l'utilisateur régularise.
 */
export function restrictionFor(acc: Pick<Account, "mustChangePassword" | "twoFactorEnabled" | "role">, policy: Pick<ResolvedPolicy, "requires2fa">): Restriction | null {
  if (acc.mustChangePassword) return "pwd-change";
  if (!acc.twoFactorEnabled && policy.requires2fa(acc.role)) return "2fa-setup";
  return null;
}

/** Mot de passe expiré selon la politique (0 = jamais). */
export function isPasswordExpired(passwordChangedAt: Date | null, expiryDays: number, now: Date): boolean {
  if (expiryDays <= 0 || !passwordChangedAt) return false;
  return now.getTime() - passwordChangedAt.getTime() > expiryDays * 86_400_000;
}
