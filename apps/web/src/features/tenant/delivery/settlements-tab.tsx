import { useMutation, useQuery } from "@tanstack/react-query";
import { HandCoins, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { ORDER_PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useTenant } from "../hooks";

/** Rapprochement à leur retour : les encaissements des livreurs entrent en caisse (espèces attendues dans le tiroir). */
export function SettlementsTab() {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: tenantKeys.deliverySettlements(t.root), queryFn: t.api.delivery.settlements });
  const settle = useMutation({
    mutationFn: (driverId: string) => t.api.delivery.settle(driverId),
    onSuccess: (r) => {
      toast.success(`${formatFcfa(r.total)} rapprochés en caisse`, { description: `${r.count} livraison${r.count > 1 ? "s" : ""}` });
      void qc.invalidateQueries({ queryKey: tenantKeys.deliveryAll(t.root) });
      void qc.invalidateQueries({ queryKey: tenantKeys.register(t.root) });
    },
    onError: (e) => toastError(e),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  const drivers = q.data?.drivers ?? [];
  if (!drivers.length) return <EmptyState icon={<HandCoins />} title="Rien à rapprocher" description="Les sommes encaissées par les livreurs à la remise apparaissent ici jusqu'à leur retour en caisse." />;
  return (
    <div className="flex flex-col gap-4">
      {!q.data?.registerOpen && <Callout tone="warning" title="La caisse est fermée">Ouvrez la caisse (page Caisse) avant de rapprocher les encaissements d'un livreur.</Callout>}
      <ul className="grid gap-4 md:grid-cols-2">
        {drivers.map((g) => (
          <li key={g.driver.id}>
            <Card className="flex flex-col gap-3 p-5" data-testid="settlement">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="text-[15px] font-semibold">{g.driver.name}</h3><p className="text-[13px] text-muted-foreground">{g.count} livraison{g.count > 1 ? "s" : ""} à rapprocher</p></div>
                <p className="font-mono text-xl font-semibold tabular-nums">{formatFcfa(g.total)}</p>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {Object.entries(g.byMethod).map(([m, v]) => <li key={m} className="flex justify-between"><span className="text-muted-foreground">{ORDER_PAYMENT_METHOD_LABEL[m] ?? m}</span><span className="font-mono tabular-nums">{formatFcfa(v)}</span></li>)}
              </ul>
              <ul className="flex flex-col gap-0.5 border-t border-border pt-2 text-[13px] text-muted-foreground">
                {g.deliveries.map((d) => <li key={d.id} className="flex justify-between"><span>Commande n°{d.orderNumber}</span><span className="font-mono tabular-nums">{formatFcfa(d.amount)}</span></li>)}
              </ul>
              <Button variant="primary" disabled={!q.data?.registerOpen} loading={settle.isPending && settle.variables === g.driver.id}
                onClick={() => confirm({
                  title: `Rapprocher ${formatFcfa(g.total)} de ${g.driver.name} ?`,
                  description: `Les ${formatFcfa(g.byMethod.CASH ?? 0)} en espèces entreront dans la caisse ouverte : vérifiez la somme remise par le livreur.`,
                  confirmLabel: "Rapprocher en caisse",
                  onConfirm: () => settle.mutateAsync(g.driver.id),
                })}>
                <Landmark /> Rapprocher en caisse
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
