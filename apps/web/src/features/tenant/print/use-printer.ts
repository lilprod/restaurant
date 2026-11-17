import type { Order } from "@restaurant/api-client";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { printTicket } from "@/lib/print/print-service";
import { loadPrintSettings, subscribePrintSettings, updatePrintSettings, type PrintSettings } from "@/lib/print/settings";
import { kitchenInputFromOrder, kitchenTicketDoc, receiptTicketDoc, type KitchenTicketInput, type TicketDoc } from "@/lib/print/ticket-doc";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";

/** Impression des tickets sur cet appareil : réglages locaux, poste de chaque plat (catégorie de la carte), impression automatique. */
export function usePrinter() {
  const t = useTenant();
  const slug = t.slug;
  const settings = React.useSyncExternalStore(subscribePrintSettings, () => loadPrintSettings(slug));
  // Même clé que la carte de la prise de commande : un seul chargement, partagé (et conservé hors ligne).
  const menu = useQuery({ queryKey: tenantKeys.menu(t.root), queryFn: t.api.menu.get, staleTime: 60_000, enabled: !t.isDriver });
  const stations = React.useMemo(() => new Map((menu.data ?? []).flatMap((c) => c.items.map((i) => [i.id, c.name] as const))), [menu.data]);
  const stationOf = React.useCallback((id: string | null) => (id ? stations.get(id) : undefined) ?? "Autres", [stations]);

  const print = React.useCallback(async (doc: TicketDoc, override?: Partial<PrintSettings>): Promise<boolean> => {
    try { await printTicket(doc, { ...settings, ...override }); return true; }
    catch (e) { toast.error("Impression impossible", { description: e instanceof Error ? e.message : "Vérifiez l'imprimante." }); return false; }
  }, [settings]);

  const kitchenDoc = React.useCallback((o: Order, opts: { reprint?: boolean; onlyItemIds?: Set<string> } = {}) =>
    kitchenTicketDoc(kitchenInputFromOrder(o, stationOf, opts)), [stationOf]);

  const printKitchen = React.useCallback((o: Order, opts?: { reprint?: boolean; onlyItemIds?: Set<string> }) => print(kitchenDoc(o, opts)), [print, kitchenDoc]);
  const printKitchenInput = React.useCallback((k: KitchenTicketInput) => print(kitchenTicketDoc(k)), [print]);

  const printReceipt = React.useCallback(async (orderId: string) => {
    try {
      const receipt = await t.api.orders.receipt(orderId);
      const link = await t.api.orders.trackingLink(orderId).catch(() => null);
      return await print(receiptTicketDoc(receipt, { trackingUrl: link?.url }));
    } catch (e) { toast.error("Ticket caisse indisponible", { description: e instanceof Error ? e.message : undefined }); return false; }
  }, [t.api, print]);

  /** À la création d'une commande (ou à l'ajout d'articles) : impressions automatiques réglées sur cet appareil. */
  const autoPrint = React.useCallback(async (o: Order, opts: { onlyItemIds?: Set<string> } = {}) => {
    if (settings.autoKitchen) await printKitchen(o, opts);
    if (settings.autoReceipt && !opts.onlyItemIds) await printReceipt(o.id);
  }, [settings.autoKitchen, settings.autoReceipt, printKitchen, printReceipt]);

  return {
    settings, update: (patch: Partial<PrintSettings>) => updatePrintSettings(slug, patch),
    stationOf, print, printKitchen, printKitchenInput, printReceipt, autoPrint, kitchenDoc,
  };
}
