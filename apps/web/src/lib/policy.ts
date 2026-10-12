import { DEFAULT_PASSWORD_POLICY, type PasswordPolicy } from "@restaurant/utils";

/**
 * Politiques par défaut des deux espaces (miroir de apps/api/src/settings/defaults.ts). Les comptes qui ne
 * peuvent pas lire la section « sécurité » (rôles non administrateurs) s'appuient sur ces valeurs ;
 * l'API reste l'arbitre final et renvoie les règles manquantes en cas de refus.
 */
export const DEFAULT_POLICY_BY_SPACE: Record<"platform" | "tenant", PasswordPolicy> = {
  platform: { ...DEFAULT_PASSWORD_POLICY, minLength: 12, requireSymbol: true },
  tenant: { ...DEFAULT_PASSWORD_POLICY },
};
