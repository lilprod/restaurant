export * from "./theme";
export * from "./password";
export * from "./orders";
export * from "./time";

/** Formate un montant FCFA : 12500 -> "12 500 FCFA". */
export function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}
