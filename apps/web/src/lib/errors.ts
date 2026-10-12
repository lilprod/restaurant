import { ApiError } from "@restaurant/api-client";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";

export function errorMessage(e: unknown, fallback = "Une erreur est survenue"): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** Affiche l'erreur dans un toast (avec le détail des champs si l'API en renvoie). */
export function toastError(e: unknown, fallback?: string) {
  const msg = errorMessage(e, fallback);
  const details = e instanceof ApiError && e.errors.length ? e.errors.slice(0, 3).map((x) => x.message).join(" · ") : undefined;
  toast.error(msg, details && details !== msg ? { description: details } : undefined);
}

/**
 * Reporte les erreurs de champ de l'API (`errors[]`) sur le formulaire react-hook-form.
 * Retourne true si au moins une erreur a été rattachée à un champ.
 */
export function applyApiErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, map: Record<string, Path<T>> = {}): boolean {
  if (!(e instanceof ApiError) || !e.errors.length) return false;
  let any = false;
  const seen = new Set<string>();
  for (const err of e.errors) {
    const path = (map[err.path] ?? err.path) as Path<T>;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    setError(path, { type: "server", message: err.message });
    any = true;
  }
  return any;
}
