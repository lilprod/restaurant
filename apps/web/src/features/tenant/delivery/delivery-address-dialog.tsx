import type { DeliveryZone } from "@restaurant/api-client";
import { orderDeliveryInputSchema, type OrderDeliveryInput } from "@restaurant/validation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { formatFcfa } from "@/lib/format";

export type DeliveryAddress = Partial<OrderDeliveryInput>;

/** Adresse de livraison : zone, quartier de la zone, adresse et point de repère (obligatoire à Lomé). */
export function DeliveryAddressDialog({ open, onOpenChange, zones, value, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; zones: DeliveryZone[]; value: DeliveryAddress; onSave: (v: OrderDeliveryInput) => void;
}) {
  const active = zones.filter((z) => z.isActive);
  const [draft, setDraft] = React.useState<DeliveryAddress>(value);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => { if (open) { setDraft(value.zoneId ? value : { ...value, zoneId: active[0]?.id }); setErrors({}); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);
  const zone = active.find((z) => z.id === draft.zoneId);
  const set = (patch: DeliveryAddress) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    const parsed = orderDeliveryInputSchema.safeParse({ ...draft, neighborhood: draft.neighborhood ?? "" });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    onSave(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Adresse de livraison" description="Le livreur et le client la retrouvent sur le suivi de commande."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button><Button variant="primary" onClick={save}>Enregistrer l'adresse</Button></>}>
      {active.length === 0 ? (
        <Callout tone="warning" title="Aucune zone de livraison">Un responsable doit d'abord créer une zone (page Livraisons, onglet Zones).</Callout>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Zone" required error={errors.zoneId}>
            <NativeSelect value={draft.zoneId ?? ""} onChange={(e) => set({ zoneId: e.target.value, neighborhood: "" })}>
              {active.map((z) => <option key={z.id} value={z.id}>{z.name} · {formatFcfa(z.fee)}{z.minOrder ? ` · min. ${formatFcfa(z.minOrder)}` : ""}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Quartier" required error={errors.neighborhood}>
            <NativeSelect value={draft.neighborhood ?? ""} onChange={(e) => set({ neighborhood: e.target.value })}>
              <option value="">Choisir le quartier…</option>
              {zone?.neighborhoods.map((n) => <option key={n} value={n}>{n}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Adresse" required error={errors.address} hint="Rue, numéro de maison, couleur du portail…">
            <Textarea value={draft.address ?? ""} onChange={(e) => set({ address: e.target.value })} maxLength={200} className="min-h-[64px]" />
          </Field>
          <Field label="Point de repère" required error={errors.landmark} hint="Ex. derrière la pharmacie, face à l'école, près du carrefour.">
            <Input value={draft.landmark ?? ""} onChange={(e) => set({ landmark: e.target.value })} maxLength={120} list="delivery-landmarks" />
          </Field>
          <datalist id="delivery-landmarks">{zone?.landmarks.map((l) => <option key={l} value={l} />)}</datalist>
          {zone && <p className="text-[13px] text-muted-foreground">Frais {formatFcfa(zone.fee)} · délai estimé {zone.etaMinutes} min{zone.minOrder ? ` · minimum ${formatFcfa(zone.minOrder)}` : ""}.</p>}
        </div>
      )}
    </Dialog>
  );
}
