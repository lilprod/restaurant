import { BadRequestException, Injectable } from "@nestjs/common";
import { validatePassword } from "@restaurant/utils";
import * as argon2 from "argon2";
import { randomInt } from "node:crypto";
import type { Account } from "./accounts.repo";
import type { ResolvedPolicy } from "./security-policy.service";

@Injectable()
export class PasswordService {
  /** Hash factice : on vérifie toujours un mot de passe, même pour un compte inconnu (temps de réponse constant). */
  private readonly dummy = argon2.hash("dummy-password-for-timing");

  hash(p: string) {
    return argon2.hash(p);
  }

  async verify(hash: string | null | undefined, p: string): Promise<boolean> {
    return argon2.verify(hash ?? (await this.dummy), p).then((ok) => ok && !!hash).catch(() => false);
  }

  /** Refuse (400) un mot de passe qui ne respecte pas la politique, en listant les règles manquantes. */
  assertValid(password: string, policy: ResolvedPolicy, who: Pick<Account, "email" | "firstName" | "lastName"> | { email: string; firstName?: string; lastName?: string }) {
    const errors = validatePassword(password, policy.passwordPolicy, {
      email: who.email, names: [who.firstName ?? "", who.lastName ?? ""].filter(Boolean),
    });
    if (errors.length) {
      throw new BadRequestException({ message: "Mot de passe trop faible", errors: errors.map((message) => ({ path: "newPassword", message })) });
    }
  }

  /** Mot de passe temporaire conforme à la politique (affiché une seule fois à l'administrateur). */
  generateTemporary(policy: ResolvedPolicy): string {
    const sets = { u: "ABCDEFGHJKLMNPQRSTUVWXYZ", l: "abcdefghijkmnopqrstuvwxyz", d: "23456789", s: "!@#$%&*?" };
    const pick = (s: string) => s[randomInt(s.length)];
    const len = Math.max(policy.passwordPolicy.minLength, 14);
    const chars = [pick(sets.u), pick(sets.l), pick(sets.d), pick(sets.s)];
    const all = sets.u + sets.l + sets.d;
    while (chars.length < len) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {   // mélange Fisher–Yates
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
  }
}
