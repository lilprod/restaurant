import type { Order } from "@restaurant/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { API_BASE, getTenantSpace } from "@/app/spaces";
import { RealtimeConnection, realtimeOrigin, type RealtimeStatus } from "@/lib/realtime/connection";
import { applyOrderEvent, resyncServiceQueries } from "@/lib/realtime/order-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSession } from "./session";

type OrderListener = (event: "order.created" | "order.updated", order: Order) => void;

interface RealtimeCtx {
  status: RealtimeStatus;
  subscribe: (fn: OrderListener) => () => void;
  reconnect: () => void;
}

const Ctx = React.createContext<RealtimeCtx>({ status: "idle", subscribe: () => () => undefined, reconnect: () => undefined });

/**
 * Temps réel du restaurant : une seule socket pour tout l'espace connecté. Chaque événement de commande
 * met à jour les caches TanStack Query (détail, listes, cuisine, tables) ; les écrans peuvent aussi
 * s'abonner (surlignage et son à l'écran cuisine).
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = React.useState<RealtimeStatus>("idle");
  const listeners = React.useRef(new Set<OrderListener>());
  const connRef = React.useRef<RealtimeConnection | null>(null);
  const root = session.queryKey;
  const enabled = session.space === "tenant" && session.status === "authenticated" && !session.restriction && !session.blocked;

  const localization = useQuery({
    queryKey: tenantKeys.settings(root, "localization"),
    queryFn: () => getTenantSpace(session.slug!).api.settings.get("localization"),
    enabled,
    staleTime: 5 * 60_000,
  });
  const tzRef = React.useRef<string | undefined>(undefined);
  tzRef.current = localization.data?.timezone;

  React.useEffect(() => {
    if (!enabled) return;
    const conn = new RealtimeConnection({
      origin: realtimeOrigin(API_BASE),
      client: session.client,
      handlers: {
        onStatus: setStatus,
        onOrder: (event, order) => {
          applyOrderEvent(qc, root, order, { timeZone: tzRef.current });
          for (const l of [...listeners.current]) l(event, order);
        },
        onResync: () => resyncServiceQueries(qc, root),
        onOther: (event) => {
          if (event.startsWith("menu.")) void qc.invalidateQueries({ queryKey: tenantKeys.menu(root) });
          if (event.startsWith("table.")) void qc.invalidateQueries({ queryKey: tenantKeys.tables(root) });
        },
      },
    });
    connRef.current = conn;
    void conn.start();
    const offline = () => setStatus("offline");
    const online = () => conn.reconnectNow();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      conn.stop();
      connRef.current = null;
    };
  }, [enabled, session.client, qc, root]);

  const subscribe = React.useCallback((fn: OrderListener) => {
    listeners.current.add(fn);
    return () => { listeners.current.delete(fn); };
  }, []);
  const reconnect = React.useCallback(() => connRef.current?.reconnectNow(), []);
  const value = React.useMemo(() => ({ status, subscribe, reconnect }), [status, subscribe, reconnect]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRealtime = () => React.useContext(Ctx);

/** S'abonner aux événements de commande (le callback le plus récent est toujours utilisé). */
export function useOrderEvents(fn: OrderListener) {
  const { subscribe } = useRealtime();
  const ref = React.useRef(fn);
  ref.current = fn;
  React.useEffect(() => subscribe((e, o) => ref.current(e, o)), [subscribe]);
}
