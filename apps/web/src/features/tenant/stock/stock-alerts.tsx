import { ArrowRight, Package, PackageCheck, Trash2, Truck } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatQty } from "@/lib/format";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { StockStateBadge, WasteDialog } from "./stock-dialogs";
import { useStockAlerts } from "./stock-hooks";

/** Widget de l'accueil gérant : ingrédients sous le seuil, épuisés ou négatifs ; commande fournisseur pré-remplie. */
export function StockAlertsCard({ className }: { className?: string }) {
  const t = useTenant();
  const to = useSpacePath();
  const q = useStockAlerts();
  if (!q.moduleEnabled || q.isError) return null;
  const alerts = q.data ?? [];
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between gap-2 p-5 pb-3 sm:p-6 sm:pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Alertes de stock</h2>
          <p className="text-[13px] text-muted-foreground">{alerts.length ? `${alerts.length} ingrédient${alerts.length > 1 ? "s" : ""} à réapprovisionner.` : "Ingrédients sous le seuil d'alerte."}</p>
        </div>
        <div className="flex gap-2">
          {t.isManager && alerts.length > 0 && <Button asChild size="sm" variant="secondary"><Link to={to("/fournisseurs?nouvelle=alertes")}><Truck /> Commander</Link></Button>}
          <Button asChild variant="ghost" size="sm"><Link to={to("/stock")}>Stock <ArrowRight /></Link></Button>
        </div>
      </div>
      {q.isLoading ? (
        <div className="flex flex-col gap-3 px-6 pb-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : !alerts.length ? (
        <EmptyState icon={<PackageCheck />} title="Tout est en stock" description="Vous serez prévenu dès qu'un ingrédient passe sous son seuil." className="py-8" />
      ) : (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {alerts.slice(0, 6).map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
              <span className="shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground">{formatQty(a.quantity, a.unit)}</span>
              <StockStateBadge state={a.state} />
            </li>
          ))}
          {alerts.length > 6 && <li className="px-5 py-3 text-[13px] text-muted-foreground sm:px-6"><Link className="hover:underline" to={to("/stock?etat=alert")}>Voir les {alerts.length} alertes</Link></li>}
        </ul>
      )}
    </Card>
  );
}

/** Écran cuisine : bouton « Stock » (nombre d'alertes) → liste lisible à distance + déclaration de perte. */
export function KitchenStockButton({ className }: { className?: string }) {
  const q = useStockAlerts();
  const [open, setOpen] = React.useState(false);
  const [waste, setWaste] = React.useState(false);
  if (!q.moduleEnabled) return null;
  const alerts = q.data ?? [];
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)} aria-label={`Stock : ${alerts.length} alerte${alerts.length > 1 ? "s" : ""}`}>
        <Package /> Stock
        {alerts.length > 0 && <span className="rounded-full bg-[var(--tone-amber-bg)] px-2 font-mono text-sm text-[var(--tone-amber-fg)] tabular-nums">{alerts.length}</span>}
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Stock à surveiller" description="Ingrédients sous le seuil d'alerte ou épuisés."
        footer={<><Button variant="ghost" className="h-12 text-base" onClick={() => setOpen(false)}>Fermer</Button><Button variant="primary" className="h-12 text-base" onClick={() => { setOpen(false); setWaste(true); }}><Trash2 /> Déclarer une perte</Button></>}>
        {!alerts.length ? <EmptyState icon={<PackageCheck />} title="Tout est en stock" className="py-8" /> : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3 text-base">
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <span className="font-mono tabular-nums">{formatQty(a.quantity, a.unit)}</span>
                <StockStateBadge state={a.state} />
              </li>
            ))}
          </ul>
        )}
      </Dialog>
      <WasteDialog open={waste} onClose={() => setWaste(false)} />
    </>
  );
}
