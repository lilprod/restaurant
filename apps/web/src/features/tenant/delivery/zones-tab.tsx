import type { DeliveryZone } from "@restaurant/api-client";
import { deliveryZoneInputSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPinned, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@restaurant/api-client";
import { toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";

const lines = (v: string) => v.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);

/** Zones par quartier : frais, minimum de commande, délai estimé, repères connus (responsables). */
export function ZonesTab() {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<DeliveryZone | "new" | null>(null);
  const q = useQuery({ queryKey: tenantKeys.deliveryZones(t.root), queryFn: t.api.delivery.zones });
  const refresh = () => qc.invalidateQueries({ queryKey: tenantKeys.deliveryZones(t.root) });
  const toggle = useMutation({
    mutationFn: (z: DeliveryZone) => t.api.delivery.updateZone(z.id, { isActive: !z.isActive }),
    onSuccess: refresh, onError: (e) => toastError(e),
  });
  const remove = useMutation({
    mutationFn: (z: DeliveryZone) => t.api.delivery.deleteZone(z.id),
    onSuccess: () => { toast.success("Zone supprimée"); void refresh(); }, onError: (e) => toastError(e),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.isLoading) return <Skeleton className="h-40 rounded-xl" />;
  const zones = q.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end"><Button variant="primary" onClick={() => setEditing("new")}><Plus /> Nouvelle zone</Button></div>
      {zones.length === 0 ? (
        <EmptyState icon={<MapPinned />} title="Aucune zone de livraison" description="Regroupez les quartiers desservis, avec leurs frais et un minimum de commande." action={<Button variant="primary" onClick={() => setEditing("new")}><Plus /> Créer une zone</Button>} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {zones.map((z) => (
            <li key={z.id}>
              <Card className="flex flex-col gap-3 p-5" data-testid="zone">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h3 className="flex items-center gap-2 text-[15px] font-semibold">{z.name} {!z.isActive && <Badge tone="gray">Désactivée</Badge>}</h3>
                    <p className="mt-1 text-[13px] text-muted-foreground">{z.neighborhoods.join(" · ")}</p></div>
                  <label className="flex items-center gap-2 text-[13px]"><Switch checked={z.isActive} onCheckedChange={() => toggle.mutate(z)} aria-label={`Zone ${z.name} active`} /></label>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-[12px] text-muted-foreground">Frais</dt><dd className="font-mono tabular-nums">{formatFcfa(z.fee)}</dd></div>
                  <div><dt className="text-[12px] text-muted-foreground">Minimum</dt><dd className="font-mono tabular-nums">{z.minOrder ? formatFcfa(z.minOrder) : "—"}</dd></div>
                  <div><dt className="text-[12px] text-muted-foreground">Délai</dt><dd className="font-mono tabular-nums">{z.etaMinutes} min</dd></div>
                </dl>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(z)}><Pencil /> Modifier</Button>
                  <Button variant="ghost" size="sm" onClick={() => confirm({
                    title: `Supprimer la zone « ${z.name} » ?`, description: "Une zone qui a déjà servi à une livraison ne peut être que désactivée.",
                    confirmLabel: "Supprimer", tone: "danger", onConfirm: () => remove.mutateAsync(z),
                  })}><Trash2 /> Supprimer</Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ZoneDialog zone={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />
    </div>
  );
}

function ZoneDialog({ zone, onClose, onSaved }: { zone: DeliveryZone | "new" | null; onClose: () => void; onSaved: () => void }) {
  const t = useTenant();
  const z = zone === "new" ? null : zone;
  const [f, setF] = React.useState({ name: "", neighborhoods: "", landmarks: "", fee: "1000", minOrder: "0", etaMinutes: "45" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!zone) return;
    setErrors({});
    setF(z ? { name: z.name, neighborhoods: z.neighborhoods.join("\n"), landmarks: z.landmarks.join("\n"), fee: String(z.fee), minOrder: String(z.minOrder), etaMinutes: String(z.etaMinutes) }
      : { name: "", neighborhoods: "", landmarks: "", fee: "1000", minOrder: "0", etaMinutes: "45" });
  }, [zone, z]);
  const save = useMutation({
    mutationFn: () => {
      const parsed = deliveryZoneInputSchema.safeParse({
        name: f.name, neighborhoods: lines(f.neighborhoods), landmarks: lines(f.landmarks), fee: Number(f.fee), minOrder: Number(f.minOrder), etaMinutes: Number(f.etaMinutes), isActive: z?.isActive ?? true,
      });
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        return Promise.reject(new Error(parsed.error.issues[0]?.message));
      }
      setErrors({});
      return z ? t.api.delivery.updateZone(z.id, parsed.data) : t.api.delivery.createZone(parsed.data);
    },
    onSuccess: () => { toast.success(z ? "Zone enregistrée" : "Zone créée"); onSaved(); },
    onError: (e) => { if (e instanceof ApiError) toastError(e); },
  });
  const num = (k: "fee" | "minOrder" | "etaMinutes") => (e: React.ChangeEvent<HTMLInputElement>) => setF((s) => ({ ...s, [k]: e.target.value.replace(/\D/g, "") }));
  return (
    <Dialog open={!!zone} onOpenChange={(o) => !o && onClose()} title={z ? `Modifier « ${z.name} »` : "Nouvelle zone"} description="Les frais s'ajoutent au total de la commande (TVA au taux par défaut)."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer la zone</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Nom de la zone" required error={errors.name}><Input value={f.name} maxLength={60} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} placeholder="Centre-ville" /></Field>
        <Field label="Quartiers desservis" required error={errors.neighborhoods} hint="Un par ligne (ou séparés par des virgules).">
          <Textarea value={f.neighborhoods} onChange={(e) => setF((s) => ({ ...s, neighborhoods: e.target.value }))} placeholder={"Tokoin\nNyékonakpoè"} />
        </Field>
        <Field label="Repères connus" error={errors.landmarks} hint="Suggérés à la prise de commande : pharmacie, carrefour, école…">
          <Textarea value={f.landmarks} onChange={(e) => setF((s) => ({ ...s, landmarks: e.target.value }))} className="min-h-[64px]" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Frais (FCFA)" required error={errors.fee}><Input inputMode="numeric" value={f.fee} onChange={num("fee")} /></Field>
          <Field label="Minimum (FCFA)" error={errors.minOrder} hint="Plats seulement"><Input inputMode="numeric" value={f.minOrder} onChange={num("minOrder")} /></Field>
          <Field label="Délai (min)" required error={errors.etaMinutes}><Input inputMode="numeric" value={f.etaMinutes} onChange={num("etaMinutes")} /></Field>
        </div>
      </div>
    </Dialog>
  );
}
