/** Numéros de téléphone : normalisation E.164, masquage pour l'affichage. */

/** Indicatif par défaut (Togo). Les numéros locaux togolais comptent 8 chiffres. */
export const DEFAULT_COUNTRY_CODE = "228";

/**
 * Normalise un numéro en E.164 (`+22890123456`). Accepte `90 12 34 56`, `+228 90 12 34 56`, `00228…`, `(228) 90…`.
 * Un numéro à 8 chiffres sans indicatif est un numéro togolais. Retourne `null` si le numéro est invalide.
 */
export function normalizePhone(raw: string, countryCode: string = DEFAULT_COUNTRY_CODE): string | null {
  const input = raw.trim();
  if (!input || /[^\d\s+().-]/.test(input)) return null;
  const hasPlus = input.startsWith("+");
  let digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (!hasPlus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!hasPlus) {
    // Format national : 8 chiffres au Togo, avec ou sans indicatif écrit.
    if (countryCode === DEFAULT_COUNTRY_CODE) {
      if (digits.length === 8) return `+${countryCode}${digits}`;
      if (digits.length === 11 && digits.startsWith(countryCode)) return `+${digits}`;
      return null;
    }
    digits = digits.startsWith(countryCode) ? digits : `${countryCode}${digits.replace(/^0/, "")}`;
  }
  if (digits.startsWith(DEFAULT_COUNTRY_CODE) && digits.length !== 3 + 8) return null; // numéro togolais : 8 chiffres exactement
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return `+${digits}`;
}

export const isE164 = (v: string) => /^\+[1-9]\d{7,14}$/.test(v);

/** `+22890123456` → `+228 ** ** 34 56` (les deux derniers groupes restent visibles). */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length < 8) return "••••";
  const cc = e164.startsWith("+") ? `+${d.slice(0, d.length - 8)}` : "";
  const tail = d.slice(-4);
  return `${cc} •• •• ${tail.slice(0, 2)} ${tail.slice(2)}`.trim();
}

/** `kofi.mensah@gmail.com` → `k••••@gmail.com`. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "••••";
  return `${email[0]}••••${email.slice(at)}`;
}
