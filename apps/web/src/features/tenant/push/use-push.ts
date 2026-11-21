import * as React from "react";
import { toast } from "sonner";
import { toastError } from "@/lib/errors";
import { currentSubscription, disablePush, enablePush, readPushState, type PushState } from "@/lib/push";
import { useTenant } from "../hooks";

/** État des notifications push de CET appareil et actions (activer sur geste, tester, désactiver). */
export function usePush() {
  const t = useTenant();
  const api = t.api.push;
  const [state, setState] = React.useState<PushState>("loading");
  const [busy, setBusy] = React.useState<null | "enable" | "test" | "disable">(null);
  const alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = React.useCallback(async () => {
    const next = await readPushState(api);
    if (alive.current) setState(next);
  }, [api]);
  React.useEffect(() => {
    void refresh();
    // L'autorisation se change dans les réglages du navigateur : on relit l'état au retour sur l'application.
    const on = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", on);
    window.addEventListener("focus", on);
    return () => { document.removeEventListener("visibilitychange", on); window.removeEventListener("focus", on); };
  }, [refresh]);

  const run = async (kind: "enable" | "test" | "disable", fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } catch (e) { toastError(e, "Action impossible"); } finally { if (alive.current) setBusy(null); }
  };

  return {
    state, busy, refresh,
    /** À appeler depuis un clic (l'autorisation du navigateur l'exige). */
    enable: () => run("enable", async () => {
      const r = await enablePush(api);
      if (r === "on") toast.success("Notifications activées sur cet appareil");
      else if (r === "denied") toast.error("Autorisation refusée", { description: "Autorisez les notifications pour ce site dans les réglages du navigateur." });
      await refresh();
    }),
    test: () => run("test", async () => {
      await api.test((await currentSubscription())?.endpoint);
      toast.success("Notification de test envoyée", { description: "Elle arrive dans quelques secondes." });
    }),
    disable: () => run("disable", async () => {
      await disablePush(api);
      toast.success("Notifications désactivées sur cet appareil");
      await refresh();
    }),
  };
}
