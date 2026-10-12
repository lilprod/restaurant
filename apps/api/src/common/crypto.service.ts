import { Inject, Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { APP_ENV, Env } from "../config/env";

/** Chiffrement AES-256-GCM des secrets stockés en base (secrets TOTP). Format : v1:iv:tag:données (base64). */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(APP_ENV) env: Env) {
    // Hors production, la clé peut être dérivée du secret JWT pour faciliter le démarrage.
    this.key = createHash("sha256").update(env.DATA_ENCRYPTION_KEY ?? `dev:${env.JWT_ACCESS_SECRET}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const [v, iv, tag, data] = payload.split(":");
    if (v !== "v1" || !iv || !tag || !data) throw new Error("Format de secret chiffré inconnu");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  }
}
