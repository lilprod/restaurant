import type { AssetKind } from "@restaurant/api-client";

/** Règles alignées sur l'API (apps/api/src/storage/image-validation.ts). L'API revérifie la signature binaire. */
export type UploadKind = AssetKind | "avatar";

export const UPLOAD_RULES: Record<UploadKind, { maxBytes: number; types: string[]; extensions: string[]; label: string }> = {
  logo: { maxBytes: 2 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"], extensions: ["png", "jpg", "jpeg", "webp"], label: "PNG, JPEG ou WebP · 2 Mo max" },
  logoDark: { maxBytes: 2 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"], extensions: ["png", "jpg", "jpeg", "webp"], label: "PNG, JPEG ou WebP · 2 Mo max" },
  favicon: {
    maxBytes: 512 * 1024,
    types: ["image/png", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"],
    extensions: ["png", "ico", "webp"],
    label: "PNG, ICO ou WebP · 512 Ko max",
  },
  avatar: { maxBytes: 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"], extensions: ["png", "jpg", "jpeg", "webp"], label: "PNG, JPEG ou WebP · 1 Mo max" },
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

/** Vérification côté client (type + taille) avant l'envoi. Retourne un message d'erreur, ou null. */
export function precheckFile(file: File, kind: UploadKind): string | null {
  const rule = UPLOAD_RULES[kind];
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type === "image/svg+xml" || ext === "svg") return "Le SVG n'est pas accepté (il peut contenir du script).";
  if (!rule.types.includes(file.type) && !rule.extensions.includes(ext)) return `Format non accepté. ${rule.label}.`;
  if (file.size > rule.maxBytes) return `Fichier trop volumineux (${formatBytes(file.size)}). Maximum ${formatBytes(rule.maxBytes)}.`;
  return null;
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
