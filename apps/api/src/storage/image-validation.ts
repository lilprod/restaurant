import { BadRequestException } from "@nestjs/common";

export interface UploadRule {
  maxBytes: number;
  allowed: ReadonlyArray<"png" | "jpeg" | "webp" | "ico">;
}

export const ASSET_RULES: Record<"logo" | "logoDark" | "favicon" | "avatar", UploadRule> = {
  avatar: { maxBytes: 1024 * 1024, allowed: ["png", "jpeg", "webp"] },
  logo: { maxBytes: 2 * 1024 * 1024, allowed: ["png", "jpeg", "webp"] },
  logoDark: { maxBytes: 2 * 1024 * 1024, allowed: ["png", "jpeg", "webp"] },
  favicon: { maxBytes: 512 * 1024, allowed: ["png", "ico", "webp"] },
};

/** Détecte le vrai format d'après les premiers octets (on ne fait jamais confiance au type MIME ni à l'extension). */
export function sniffImage(buf: Buffer): "png" | "jpeg" | "webp" | "ico" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buf.length >= 6 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0 && buf[4] > 0) return "ico";
  return null;
}

/** SVG volontairement refusé : il peut embarquer du script (XSS). */
export function validateImage(buf: Buffer | undefined, rule: UploadRule): "png" | "jpeg" | "webp" | "ico" {
  if (!buf || buf.length === 0) throw new BadRequestException("Aucun fichier reçu (champ « file »)");
  if (buf.length > rule.maxBytes) {
    throw new BadRequestException(`Fichier trop volumineux (maximum ${Math.round(rule.maxBytes / 1024)} Ko)`);
  }
  const type = sniffImage(buf);
  if (!type || !rule.allowed.includes(type)) {
    throw new BadRequestException(`Format non accepté. Formats autorisés : ${rule.allowed.join(", ").toUpperCase()}`);
  }
  return type;
}
