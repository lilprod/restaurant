import type { Account } from "../security/accounts.repo";

/** Rôles du personnel (le rôle CUSTOMER n'a pas accès au back-office). */
export const STAFF = ["ADMIN", "MANAGER", "WAITER", "KITCHEN"] as const;
/** Salle : prise de commande, service, encaissement. */
export const FLOOR = ["ADMIN", "MANAGER", "WAITER"] as const;
/** Cuisine : avancement des préparations. */
export const KITCHEN = ["ADMIN", "MANAGER", "KITCHEN"] as const;
/** Responsables : menu, tables, remboursements, annulations, caisse. */
export const MANAGERS = ["ADMIN", "MANAGER"] as const;

export const isManager = (acc: Pick<Account, "role">) => acc.role === "ADMIN" || acc.role === "MANAGER";
export const tenantOf = (acc: Pick<Account, "tenantId">) => acc.tenantId!;
