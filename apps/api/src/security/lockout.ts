/** Verrouillage temporaire après des échecs répétés (mot de passe ou code 2FA). Fonctions pures. */
export interface LockoutPolicy {
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return !!lockedUntil && lockedUntil > now;
}

export function minutesLeft(lockedUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 60_000));
}

/**
 * Nouvel état après un échec. Une série d'échecs déjà verrouillée puis expirée repart de zéro,
 * pour qu'un verrouillage échu ne reverrouille pas au premier nouvel échec.
 */
export function registerFailure(
  state: { failedLoginCount: number; lockedUntil: Date | null },
  policy: LockoutPolicy,
  now: Date,
): { failedLoginCount: number; lockedUntil: Date | null } {
  const expired = state.lockedUntil !== null && state.lockedUntil <= now;
  const count = (expired ? 0 : state.failedLoginCount) + 1;
  if (count >= policy.maxFailedAttempts) {
    return { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + policy.lockoutMinutes * 60_000) };
  }
  return { failedLoginCount: count, lockedUntil: null };
}
