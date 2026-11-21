import { BellRing, X } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useUser } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { usePush } from "./use-push";

const key = (slug: string, userId: string) => `push-reminder:${slug}:${userId}`;

/** Rappel discret (accueil livreur / serveur) tant que les notifications ne sont pas activées sur l'appareil ; on peut le masquer. */
export function PushReminder({ className }: { className?: string }) {
  const t = useTenant();
  const user = useUser();
  const to = useSpacePath();
  const p = usePush();
  const [hidden, setHidden] = React.useState(() => { try { return localStorage.getItem(key(t.slug, user.id)) === "1"; } catch { return false; } });
  if (hidden || (p.state !== "off" && p.state !== "ios-install")) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(key(t.slug, user.id), "1"); } catch { /* stockage indisponible */ } };
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm ${className ?? ""}`} data-testid="push-reminder">
      <BellRing className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">
        {p.state === "off" ? "Recevez vos alertes même écran verrouillé." : "Ajoutez l'application à l'écran d'accueil pour recevoir vos alertes."}
      </p>
      {p.state === "off"
        ? <Button size="sm" variant="secondary" onClick={() => void p.enable()} loading={p.busy === "enable"}>Activer</Button>
        : <Button size="sm" variant="secondary" asChild><Link to={to("/impression")}>Voir comment</Link></Button>}
      <button type="button" onClick={hide} aria-label="Masquer ce rappel" className="grid size-10 shrink-0 sm:size-8 place-items-center rounded-md text-muted-foreground hover:bg-subtle hover:text-foreground"><X className="size-4" /></button>
    </div>
  );
}
