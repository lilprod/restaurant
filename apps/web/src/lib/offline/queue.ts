import { ApiError, type Order } from "@restaurant/api-client";
import type { CreateOrderInput, OrderItemInput } from "@restaurant/validation";
import type { KitchenTicketInput } from "@/lib/print/ticket-doc";
import { idbAll, idbDelete, idbPut } from "./idb";

/** Requête mise en file hors ligne : création de commande ou ajout d'articles (jamais un encaissement). */
export interface QueuedRequest {
  /** Sert aussi de clé d'idempotence (`Idempotency-Key`) : un rejeu ne crée jamais de doublon. */
  id: string;
  kind: "order" | "items";
  /** Compte qui a saisi la commande : seul ce compte la rejoue (jamais un autre utilisateur de l'appareil). */
  userId: string;
  createdAt: string;
  /** Référence locale courte, imprimée sur le ticket cuisine hors ligne (le numéro officiel arrive à l'envoi). */
  localRef: string;
  label: string;
  /** Contenu du ticket cuisine (réimpression depuis la file, avant que la commande n'ait un numéro). */
  ticket?: KitchenTicketInput;
  /** Corps tel qu'envoyé à l'API (déjà validé). */
  order?: CreateOrderInput;
  orderId?: string;
  items?: OrderItemInput[];
  status: "pending" | "failed";
  error?: string;
  attempts: number;
}

export interface QueueStore {
  list(): Promise<QueuedRequest[]>;
  put(r: QueuedRequest): Promise<void>;
  remove(id: string): Promise<void>;
}

export const idbQueueStore = (slug: string): QueueStore => ({
  list: async () => (await idbAll<QueuedRequest>(slug, "queue")).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  put: (r) => idbPut(slug, "queue", r),
  remove: (id) => idbDelete(slug, "queue", id),
});

export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
export const localRefOf = (id: string) => `L-${id.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase()}`;

export interface FlushDeps {
  store: QueueStore;
  userId: string;
  send: (r: QueuedRequest) => Promise<Order>;
}
export interface FlushResult {
  sent: { request: QueuedRequest; order: Order }[];
  failed: QueuedRequest[];
  /** `offline` : réseau coupé ; `retry` : à réessayer plus tard (serveur occupé, session à renouveler, licence). */
  stoppedBy: "offline" | "retry" | null;
}

/** Erreur « requête déjà en cours » de l'API (409) : la première tentative est encore en traitement, on réessaiera. */
export const isInProgress = (e: ApiError) => e.status === 409 && /déjà en cours/i.test(e.message);

/**
 * Envoie, dans l'ordre de saisie, les requêtes en attente de cet utilisateur.
 * - succès : retirée de la file ;
 * - réseau coupé, 5xx, 401, licence, « déjà en cours » : conservée, on s'arrête (réessai plus tard) ;
 * - refus métier (plat épuisé, table fusionnée, données invalides…) : marquée « à vérifier » avec le message, jamais renvoyée seule.
 */
export async function flushQueue({ store, userId, send }: FlushDeps): Promise<FlushResult> {
  const out: FlushResult = { sent: [], failed: [], stoppedBy: null };
  for (const r of await store.list()) {
    if (r.status !== "pending" || r.userId !== userId) continue;
    try {
      const order = await send(r);
      await store.remove(r.id);
      out.sent.push({ request: r, order });
    } catch (e) {
      const err = e instanceof ApiError ? e : ApiError.network(e);
      const transient = err.status === 0 || err.status >= 500 || err.status === 401 || err.status === 429 || err.isLicenseBlocked || isInProgress(err);
      if (transient) {
        await store.put({ ...r, attempts: r.attempts + 1 });
        out.stoppedBy = err.status === 0 ? "offline" : "retry";
        return out;
      }
      const failed: QueuedRequest = { ...r, status: "failed", error: err.message, attempts: r.attempts + 1 };
      await store.put(failed);
      out.failed.push(failed);
    }
  }
  return out;
}
