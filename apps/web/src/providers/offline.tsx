import type { Order } from "@restaurant/api-client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { API_BASE, getTenantSpace } from "@/app/spaces";
import { OfflineStatus } from "@/components/offline-status";
import { useConfirm } from "@/components/ui/confirm";
import { idbQueueStore, flushQueue, localRefOf, newKey, type QueuedRequest } from "@/lib/offline/queue";
import { autoSaveSnapshot, loadSnapshot, restoreSnapshot } from "@/lib/offline/persist";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSession } from "./session";

export interface EnqueueInput {
  kind: QueuedRequest["kind"];
  label: string;
  ticket?: QueuedRequest["ticket"];
  order?: QueuedRequest["order"];
  orderId?: string;
  items?: QueuedRequest["items"];
  /** Clé d'idempotence déjà utilisée par la tentative en ligne qui a échoué (réseau perdu en route) : on la garde. */
  key?: string;
}

interface OfflineCtx {
  /** Faux dès qu'une requête échoue faute de réseau, ou que le navigateur se dit hors ligne ; revient à vrai quand l'API répond. */
  online: boolean;
  /** Commandes en attente d'envoi / refusées à l'envoi (« à vérifier »). */
  pending: QueuedRequest[];
  failed: QueuedRequest[];
  sending: boolean;
  enqueue: (i: EnqueueInput) => Promise<QueuedRequest>;
  flush: () => Promise<void>;
  discard: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  /** Marque le réseau comme coupé (appelé quand une requête échoue sans réponse). */
  reportNetworkFailure: () => void;
}

const Ctx = React.createContext<OfflineCtx>({
  online: true, pending: [], failed: [], sending: false,
  enqueue: async () => { throw new Error("Mode hors ligne indisponible ici"); },
  flush: async () => undefined, discard: async () => undefined, retry: async () => undefined, reportNetworkFailure: () => undefined,
});
export const useOffline = () => React.useContext(Ctx);

const PROBE_MS = 5000;
const FLUSH_RETRY_MS = 15_000;

/**
 * Mode hors ligne du restaurant (X5) : état du réseau, file de commandes saisies sans réseau (IndexedDB, rejouées à
 * l'identique avec leur `Idempotency-Key`), conservation de la carte et des tables sur l'appareil.
 * Inactif hors espace restaurant / pour un compte client.
 */
export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const qc = useQueryClient();
  const slug = session.slug;
  const user = session.user;
  const active = session.space === "tenant" && !!slug && session.status === "authenticated" && !!user && user.role !== "CUSTOMER";
  const userId = user?.id;
  const root = session.queryKey;
  const [online, setOnline] = React.useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [requests, setRequests] = React.useState<QueuedRequest[]>([]);
  const [sending, setSending] = React.useState(false);
  const [readyKey, setReadyKey] = React.useState("");
  const ready = !active || readyKey === `${slug}:${userId}`;
  const flushing = React.useRef(false);
  const resumedRef = React.useRef(false);
  resumedRef.current = session.resumedOffline;
  const store = React.useMemo(() => (slug ? idbQueueStore(slug) : null), [slug]);

  const refresh = React.useCallback(async () => {
    if (!store) return;
    try { setRequests(await store.list()); } catch { /* IndexedDB indisponible : la file reste vide */ }
  }, [store]);

  // Démarrage : carte et tables de l'appareil remises dans le cache AVANT le premier rendu des écrans, puis sauvegarde automatique.
  React.useEffect(() => {
    if (!active || !slug || !userId) { setRequests([]); return; }
    let stop: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      // La copie de l'appareil ne sert QUE sans réseau (démarrage hors ligne, ou coupure ensuite) : en ligne, les écrans
      // partent toujours des données fraîches du serveur, jamais d'une copie ancienne.
      if (!navigator.onLine || resumedRef.current) restoreSnapshot(qc, root, await loadSnapshot(slug), userId);
      await refresh();
      if (cancelled) return;
      stop = autoSaveSnapshot(qc, slug, root, userId);
      setReadyKey(`${slug}:${userId}`);
    })();
    return () => { cancelled = true; stop?.(); };
  }, [active, slug, userId, qc, root, refresh]);

  // Coupure du réseau en cours de service : les écrans qui n'ont encore rien reçu retrouvent la copie de l'appareil.
  React.useEffect(() => {
    if (online || !active || !slug || !userId) return;
    void loadSnapshot(slug).then((snap) => { restoreSnapshot(qc, root, snap, userId); });
  }, [online, active, slug, userId, qc, root]);

  // Connectivité
  const reportNetworkFailure = React.useCallback(() => setOnline(false), []);
  React.useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  React.useEffect(() => {
    if (!active || !slug) return;
    return getTenantSpace(slug).client.subscribe((ev) => { if (ev.type === "error" && ev.error.status === 0) setOnline(false); });
  }, [active, slug]);
  // Réseau coupé : on sonde l'API toutes les 5 s (le navigateur peut se croire en ligne sans accès réel à Internet).
  React.useEffect(() => {
    if (online || !active) return;
    let stopped = false;
    const probe = async () => {
      if (!navigator.onLine) return;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(`${API_BASE}/health`, { cache: "no-store", signal: ctl.signal });
        clearTimeout(t);
        if (!stopped && (r.ok || r.status < 500)) setOnline(true);
      } catch { /* toujours coupé */ }
    };
    void probe();
    const id = setInterval(probe, PROBE_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [online, active]);

  const flush = React.useCallback(async () => {
    if (!active || !store || !slug || !userId || flushing.current) return;
    flushing.current = true;
    setSending(true);
    try {
      const api = getTenantSpace(slug).api;
      const res = await flushQueue({
        store, userId,
        send: (r) => (r.kind === "order"
          ? api.orders.create(r.order!, { idempotencyKey: r.id })
          : api.orders.addItems(r.orderId!, r.items!, { idempotencyKey: r.id })) as Promise<Order>,
      });
      for (const { request, order } of res.sent) {
        toast.success(request.kind === "order" ? `Commande n°${order.number} envoyée en cuisine` : `Articles ajoutés à la commande n°${order.number}`,
          { description: `Saisie hors ligne (réf. ${request.localRef}) · ${request.label}` });
      }
      for (const f of res.failed) toast.error(`Commande ${f.localRef} refusée`, { description: f.error ?? "Vérifiez-la dans « Impression et hors ligne »." });
      if (res.sent.length) {
        void qc.invalidateQueries({ queryKey: tenantKeys.orders(root) });
        void qc.invalidateQueries({ queryKey: tenantKeys.kitchen(root) });
        void qc.invalidateQueries({ queryKey: tenantKeys.tables(root) });
      }
      if (res.stoppedBy === "offline") setOnline(false);
    } finally {
      flushing.current = false;
      setSending(false);
      await refresh();
    }
  }, [active, store, slug, userId, qc, root, refresh]);

  // Retour du réseau : envoi de la file ; tant qu'il reste des commandes en attente, nouvel essai régulier.
  const pending = requests.filter((r) => r.status === "pending" && r.userId === userId);
  const failed = requests.filter((r) => r.status === "failed" && r.userId === userId);
  React.useEffect(() => {
    if (!online || !active || !ready) return;
    void flush();
  }, [online, active, ready, flush]);
  React.useEffect(() => {
    if (!online || !active || pending.length === 0) return;
    const id = setInterval(() => void flush(), FLUSH_RETRY_MS);
    return () => clearInterval(id);
  }, [online, active, pending.length, flush]);

  // Retour du réseau après un démarrage hors ligne : on revalide la session et on rafraîchit les données.
  const { resumedOffline, reloadProfile } = session;
  React.useEffect(() => {
    if (!online || !resumedOffline) return;
    void reloadProfile().then(() => qc.invalidateQueries({ queryKey: [...root] })).catch(() => undefined);
  }, [online, resumedOffline, reloadProfile, qc, root]);

  const enqueue = React.useCallback(async (i: EnqueueInput) => {
    if (!store || !userId) throw new Error("Impossible d'enregistrer la commande sur cet appareil");
    const id = i.key ?? newKey();
    const r: QueuedRequest = {
      id, kind: i.kind, userId, createdAt: new Date().toISOString(), localRef: localRefOf(id), label: i.label, ticket: i.ticket,
      order: i.order, orderId: i.orderId, items: i.items, status: "pending", attempts: 0,
    };
    await store.put(r);
    await refresh();
    return r;
  }, [store, userId, refresh]);

  const discard = React.useCallback(async (id: string) => { await store?.remove(id); await refresh(); }, [store, refresh]);
  const retry = React.useCallback(async (id: string) => {
    const r = requests.find((x) => x.id === id);
    if (r && store) { await store.put({ ...r, status: "pending", error: undefined }); await refresh(); void flush(); }
  }, [requests, store, refresh, flush]);

  const value = React.useMemo<OfflineCtx>(() => ({
    online, pending, failed, sending, enqueue, flush, discard, retry, reportNetworkFailure,
  }), [online, requests, userId, sending, enqueue, flush, discard, retry, reportNetworkFailure]);

  if (active && !ready) return null;
  return <Ctx.Provider value={value}>{children}{active && <OfflineStatus />}</Ctx.Provider>;
}

/** Déconnexion : prévient si des commandes saisies hors ligne n'ont pas encore été envoyées (elles seraient perdues). */
export function useLogout() {
  const session = useSession();
  const { pending, failed } = useOffline();
  const confirm = useConfirm();
  const n = pending.length + failed.length;
  return React.useCallback(() => {
    if (n === 0) { void session.logout(); return; }
    confirm({
      title: "Commandes non envoyées",
      description: `${n} commande${n > 1 ? "s saisies" : " saisie"} hors ligne n'${n > 1 ? "ont" : "a"} pas encore été envoyée${n > 1 ? "s" : ""} en cuisine. En vous déconnectant, ${n > 1 ? "elles seront supprimées" : "elle sera supprimée"} de cet appareil.`,
      confirmLabel: "Supprimer et se déconnecter", cancelLabel: "Rester connecté", tone: "danger",
      onConfirm: () => session.logout(),
    });
  }, [n, session, confirm]);
}

