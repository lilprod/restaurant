import { Injectable } from "@nestjs/common";
import { authenticator } from "otplib";
import { createHash, randomBytes } from "node:crypto";
import * as QRCode from "qrcode";
import { CryptoService } from "../common/crypto.service";

authenticator.options = { window: 1 };   // tolère ±30 s de décalage d'horloge

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normalizeRecovery = (c: string) => c.replace(/[\s-]/g, "").toUpperCase();

@Injectable()
export class TotpService {
  constructor(private readonly crypto: CryptoService) {}

  async generate(accountLabel: string, issuer: string) {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(accountLabel, issuer, secret);
    return {
      secret,                                  // saisie manuelle dans l'application d'authentification
      encryptedSecret: this.crypto.encrypt(secret),
      otpauthUrl,
      qrDataUrl: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 }),
    };
  }

  verify(encryptedSecret: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    try {
      return authenticator.check(code, this.crypto.decrypt(encryptedSecret));
    } catch {
      return false;
    }
  }

  /** 8 codes de secours à usage unique, affichés une seule fois ; seuls leurs empreintes sont stockées. */
  generateRecoveryCodes(count = 8): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: count }, () => {
      const raw = randomBytes(5).toString("hex").toUpperCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    return { codes, hashes: codes.map((c) => sha(normalizeRecovery(c))) };
  }

  /** Retourne les empreintes restantes si le code est valide (il est alors consommé), sinon null. */
  consumeRecoveryCode(hashes: string[], code: string): string[] | null {
    const h = sha(normalizeRecovery(code));
    return hashes.includes(h) ? hashes.filter((x) => x !== h) : null;
  }

  looksLikeRecoveryCode(code: string): boolean {
    return /^[0-9A-F]{10}$/.test(normalizeRecovery(code));
  }
}
