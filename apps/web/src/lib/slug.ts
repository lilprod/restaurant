/** « Chez Kofi & Fils » → « chez-kofi-fils » (format accepté par l'API : minuscules, chiffres, tirets). */
export function slugify(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Génère un mot de passe robuste lisible (sans caractères ambigus). */
export function generatePassword(length = 14): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
  const all = sets.slice(0, 3).join("");
  const rnd = (n: number) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]! % n; };
  const chars = sets.map((s) => s[rnd(s.length)]!);
  while (chars.length < length) chars.push(all[rnd(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j]!, chars[i]!]; }
  return chars.join("");
}
