import type { Delivery, DeliveryInfo } from "@restaurant/api-client";
import { deliveryStatusTone } from "@restaurant/ui-tokens";
import { Clock, MapPin, Navigation, Phone, User } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { formatTime } from "@/lib/format";
import { DELIVERY_STATUS_LABEL } from "@/lib/labels";
import { mapsLink, telLink } from "./delivery-hooks";

export const DeliveryStatusBadge = ({ status }: { status: string }) => <StatusBadge status={status} labels={DELIVERY_STATUS_LABEL} toneOf={deliveryStatusTone} />;

/** Adresse, repère, téléphone (appel) et itinéraire (lien carte) : la même fiche pour la salle et le livreur. */
export function DeliveryAddress({ d }: { d: Pick<DeliveryInfo, "address" | "neighborhood" | "landmark" | "phone"> }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /><span><span className="font-medium">{d.neighborhood}</span> · {d.address}</span></p>
      <p className="flex items-start gap-2 text-muted-foreground"><Navigation className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Repère : <span className="text-foreground">{d.landmark}</span></span></p>
      <p className="flex items-center gap-2 text-muted-foreground"><Phone className="size-4 shrink-0" aria-hidden /><a className="font-mono text-foreground underline-offset-4 hover:underline" href={telLink(d.phone)}>{d.phone}</a></p>
    </div>
  );
}

export function DeliveryMeta({ d }: { d: Delivery | DeliveryInfo }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
      {d.driver && <span className="inline-flex items-center gap-1"><User className="size-3.5" aria-hidden />{d.driver.name}</span>}
      {d.eta && d.status !== "DELIVERED" && d.status !== "FAILED" && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" aria-hidden />Estimée à <span className="font-mono">{formatTime(d.eta)}</span></span>}
      {d.deliveredAt && <span>Livrée à <span className="font-mono">{formatTime(d.deliveredAt)}</span></span>}
    </p>
  );
}

export { mapsLink };
