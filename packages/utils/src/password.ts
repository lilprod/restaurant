export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
};

const COMMON = new Set([
  "password", "password1", "motdepasse", "motdepasse1", "azerty", "azerty123", "qwerty", "qwerty123",
  "123456", "12345678", "123456789", "1234567890", "admin", "admin123", "changeme", "changeme123",
  "bienvenue", "restaurant", "restaurant1", "letmein", "welcome", "welcome1", "iloveyou", "abc123",
]);

/**
 * Valide un mot de passe selon la politique. Retourne la liste des règles non respectées
 * (messages en français, affichables tels quels) ; liste vide = mot de passe accepté.
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
  context: { email?: string; names?: string[] } = {},
): string[] {
  const errors: string[] = [];
  if (password.length < policy.minLength) errors.push(`Au moins ${policy.minLength} caractères`);
  if (password.length > 128) errors.push("128 caractères maximum");
  if (policy.requireUpper && !/\p{Lu}/u.test(password)) errors.push("Au moins une majuscule");
  if (policy.requireLower && !/\p{Ll}/u.test(password)) errors.push("Au moins une minuscule");
  if (policy.requireDigit && !/\d/.test(password)) errors.push("Au moins un chiffre");
  if (policy.requireSymbol && !/[^\p{L}\d\s]/u.test(password)) errors.push("Au moins un symbole");

  const lower = password.toLowerCase();
  if (COMMON.has(lower)) errors.push("Mot de passe trop courant");
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) errors.push("Ne doit pas contenir votre adresse email");
  for (const n of context.names ?? []) {
    if (n.length >= 4 && lower.includes(n.toLowerCase())) {
      errors.push("Ne doit pas contenir votre nom");
      break;
    }
  }
  return errors;
}
