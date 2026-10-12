export { };

/** Formate un montant FCFA : 12500 -> "12 500 FCFA". */
export function formatFcfa(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(amount)} FCFA`;
}
