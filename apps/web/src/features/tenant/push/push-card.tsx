import { Bell, BellOff, BellRing, Share, SquarePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SettingsSection } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useTenant } from "../hooks";
import { usePush } from "./use-push";

/** Ce que reçoit chaque rôle (mêmes règles que l'API : livreur, serveur de la commande, comptes « Cuisine »). */
function receives(role: string): string {
  if (role === "DRIVER") return "une livraison attribuée ou retirée, une commande prête à récupérer";
  if (role === "KITCHEN") return "une nouvelle commande, des articles ajoutés";
  return "les plats ou la commande prêts, pour vos commandes";
}

/** « Notifications sur cet appareil » : état, Activer / Tester / Désactiver, explications selon le navigateur. */
export function PushCard() {
  const t = useTenant();
  const p = usePush();
  const { state, busy } = p;

  return (
    <SettingsSection
      title="Notifications sur cet appareil"
      description="Soyez alerté même quand l'application est fermée ou l'écran verrouillé. Ce réglage ne vaut que pour cet appareil."
      footer={
        <>
          <span className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="push-state" data-state={state}>
            {state === "on" ? <><Badge tone="green" dot>Activées</Badge> sur cet appareil</>
              : state === "off" ? <><Badge tone="gray" dot>Désactivées</Badge> sur cet appareil</>
              : state === "denied" ? <><Badge tone="red" dot>Refusées</Badge> par le navigateur</>
              : state === "loading" ? "Vérification…" : <><BellOff className="size-4" aria-hidden /> Indisponibles ici</>}
          </span>
          <div className="flex flex-wrap gap-2">
            {state === "on" && (
              <>
                <Button variant="secondary" onClick={() => void p.test()} loading={busy === "test"} disabled={busy !== null}><BellRing /> Tester</Button>
                <Button variant="ghost" onClick={() => void p.disable()} loading={busy === "disable"} disabled={busy !== null}>Désactiver</Button>
              </>
            )}
            {state === "off" && <Button variant="primary" onClick={() => void p.enable()} loading={busy === "enable"} disabled={busy !== null}><Bell /> Activer</Button>}
          </div>
        </>
      }
    >
      {state === "loading" && <Skeleton className="h-10 w-full rounded-lg" />}

      {(state === "on" || state === "off") && (
        <p className="text-sm text-muted-foreground">
          Vous recevrez : <span className="text-foreground">{receives(t.role)}</span>.
          {state === "off" && " Le navigateur vous demandera l'autorisation au moment d'activer."}
        </p>
      )}

      {state === "ios-install" && (
        <Callout tone="info" title="Sur iPhone, ajoutez d'abord l'application à l'écran d'accueil">
          <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5">
            <li>Dans Safari, touchez le bouton Partager <Share className="inline size-3.5 align-[-2px]" aria-label="Partager" />.</li>
            <li>Choisissez « Sur l'écran d'accueil » <SquarePlus className="inline size-3.5 align-[-2px]" aria-hidden />, puis « Ajouter ».</li>
            <li>Ouvrez l'application depuis son icône, revenez sur cet écran et touchez « Activer ».</li>
          </ol>
          <p className="mt-2 text-[13px]">Nécessite iOS 16.4 ou plus récent. Sans l'icône sur l'écran d'accueil, l'iPhone ne délivre pas les notifications.</p>
        </Callout>
      )}

      {state === "denied" && (
        <Callout tone="warning" title="Les notifications sont bloquées pour ce site">
          <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5">
            <li>Touchez l'icône à gauche de l'adresse (cadenas ou réglages), puis « Autorisations » ou « Paramètres du site ».</li>
            <li>Passez « Notifications » sur « Autoriser ».</li>
            <li>Revenez ici : le bouton « Activer » réapparaît.</li>
          </ol>
        </Callout>
      )}

      {state === "server-off" && (
        <Callout tone="info" title="Notifications non configurées sur ce serveur">Demandez à l'administrateur de la plateforme d'activer les notifications push.</Callout>
      )}

      {state === "unsupported" && (
        <Callout tone="info" title="Ce navigateur ne peut pas recevoir de notifications">
          Utilisez Chrome, Edge ou Firefox sur Android ou ordinateur, ou installez l'application. Les notifications exigent aussi une connexion sécurisée (HTTPS).
        </Callout>
      )}
    </SettingsSection>
  );
}
