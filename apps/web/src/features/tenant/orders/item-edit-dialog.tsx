import type { Order, OrderItem } from "@restaurant/api-client";
import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { useApplyOrder, useTenant } from "../hooks";

const MAX_INSTRUCTIONS = 200;

/** Modifier la quantité et les consignes d'un article encore « En attente » (PATCH /tenant/orders/:id/items/:itemId). */
export function ItemEditDialog({ order, item, open, onOpenChange }: { order: Order; item: OrderItem; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTenant();
  const apply = useApplyOrder();
  const [quantity, setQuantity] = React.useState(item.quantity);
  const [instructions, setInstructions] = React.useState(item.instructions ?? "");
  React.useEffect(() => {
    if (open) { setQuantity(item.quantity); setInstructions(item.instructions ?? ""); }
  }, [open, item.quantity, item.instructions]);

  const unit = item.unitPrice + item.optionsExtra;
  const changed = quantity !== item.quantity || instructions.trim() !== (item.instructions ?? "");
  const save = useMutation({
    mutationFn: () => t.api.orders.updateItem(order.id, item.id, {
      ...(quantity !== item.quantity ? { quantity } : {}),
      ...(instructions.trim() !== (item.instructions ?? "") ? { instructions: instructions.trim() } : {}),
    }),
    onSuccess: (r) => { apply(r); toast.success(`« ${item.name} » modifié`); onOpenChange(false); },
    onError: (e) => toastError(e),
  });

  return (
    <Dialog
      open={open} onOpenChange={onOpenChange} size="sm" title={`Modifier « ${item.name} »`}
      description="Possible tant que la cuisine n'a pas commencé et que l'article n'est pas encaissé."
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button><Button variant="primary" disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>Enregistrer</Button></>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Quantité</span>
          <Stepper label="quantité" value={quantity} min={1} max={99} size="lg" onChange={(v) => setQuantity(Math.max(1, Math.min(99, v)))} />
        </div>
        <p className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Total de la ligne</span><span className="font-mono tabular-nums text-foreground">{formatFcfa(unit * quantity)}</span>
        </p>
        <Field label="Consignes pour la cuisine" hint={`${instructions.length}/${MAX_INSTRUCTIONS}`}>
          <Textarea value={instructions} maxLength={MAX_INSTRUCTIONS} rows={3} placeholder="Sans piment, bien cuit…" onChange={(e) => setInstructions(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
