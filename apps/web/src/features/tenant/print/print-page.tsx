import { Cable, CloudOff, Printer, RefreshCw, Trash2, Usb, Wifi } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SettingsSection } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { formatDateShort, formatTime } from "@/lib/format";
import { pairSerial, pairUsb, webSerialSupported, webUsbSupported } from "@/lib/print/drivers";
import type { PrinterDriverKind } from "@/lib/print/settings";
import { testTicketDoc, kitchenTicketDoc } from "@/lib/print/ticket-doc";
import { useOffline } from "@/providers/offline";
import { useTenant } from "../hooks";
import { usePrinter } from "./use-printer";

/** « Impression et hors ligne » : imprimante de cet appareil (réglages locaux) et file des commandes saisies sans réseau. */
export function PrintPage() {
  const t = useTenant();
  const printer = usePrinter();
  const { settings, update } = printer;
  const off = useOffline();
  const [busy, setBusy] = React.useState(false);
  const serialOk = webSerialSupported();
  const usbOk = webUsbSupported();
  const thermal = settings.driver !== "browser";
  const paired = settings.driver === "serial" ? settings.serialPort?.label : settings.driver === "usb" ? settings.usbDevice?.label : undefined;

  const connect = async () => {
    setBusy(true);
    try {
      if (settings.driver === "serial") update({ serialPort: await pairSerial() });
      else if (settings.driver === "usb") update({ usbDevice: await pairUsb() });
      toast.success("Imprimante autorisée");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError")) toast.error("Connexion impossible", { description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { if (await printer.print(testTicketDoc(`${t.slug} · ${thermal ? "ESC/POS" : "navigateur"}`))) toast.success("Ticket de test envoyé"); } finally { setBusy(false); }
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Impression et hors ligne" description="Réglages valables pour cet appareil seulement, et commandes saisies sans réseau." />

      <SettingsSection
        title="Commandes hors ligne"
        description="Sans réseau, la prise de commande continue : les commandes sont gardées sur cet appareil puis envoyées automatiquement au retour du réseau, une seule fois. L'encaissement reste impossible hors ligne."
        footer={<>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {off.online ? <><Wifi className="size-4" aria-hidden /> Réseau disponible</> : <><CloudOff className="size-4" aria-hidden /> Réseau coupé</>}
          </span>
          <Button variant="secondary" onClick={() => void off.flush()} disabled={!off.online || off.sending || off.pending.length === 0} loading={off.sending}><RefreshCw /> Envoyer maintenant</Button>
        </>}
      >
        {off.pending.length + off.failed.length === 0 ? (
          <EmptyState icon={<CloudOff />} title="Aucune commande en attente" description="Les commandes saisies hors ligne apparaissent ici jusqu'à leur envoi en cuisine." />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="offline-queue">
            {[...off.failed, ...off.pending].map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span className="font-mono">{r.localRef}</span> {r.label}
                    {r.status === "failed" ? <Badge tone="red" dot>À vérifier</Badge> : <Badge tone="amber" dot>En attente</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">Saisie le {formatDateShort(r.createdAt)} à {formatTime(r.createdAt)}{r.attempts > 0 && ` · ${r.attempts} essai${r.attempts > 1 ? "s" : ""}`}</span>
                  {r.error && <span role="alert" className="text-[13px] text-[var(--tone-red-fg)]">{r.error}</span>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {r.ticket && <Button variant="secondary" size="sm" onClick={() => void printer.print(kitchenTicketDoc({ ...r.ticket!, reprint: true }))}><Printer /> Ticket cuisine</Button>}
                  {r.status === "failed" && <Button variant="secondary" size="sm" onClick={() => void off.retry(r.id)}><RefreshCw /> Renvoyer</Button>}
                  <Button variant="ghost" size="sm" onClick={() => void off.discard(r.id)} aria-label={`Supprimer la commande ${r.localRef}`}><Trash2 /> Supprimer</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="Imprimante de cet appareil" description="Le ticket cuisine (gros caractères, regroupé par poste) et le ticket caisse s'impriment avec le pilote choisi ici.">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium" id="driver-label">Pilote</span>
            <Segmented<PrinterDriverKind> ariaLabel="Pilote d'impression" value={settings.driver} onChange={(driver) => update({ driver })}
              options={[
                { value: "browser", label: "Navigateur", icon: <Printer /> },
                { value: "serial", label: "Série", icon: <Cable /> },
                { value: "usb", label: "USB", icon: <Usb /> },
              ]} />
            <p className="text-[13px] text-muted-foreground">
              {settings.driver === "browser" ? "Boîte d'impression du navigateur, papier 80 mm. Pour imprimer sans confirmation, lancez Chrome en mode « kiosk-printing »." : "Imprimante thermique ESC/POS branchée en USB (Chrome ou Edge). L'autorisation se donne une fois, sans boîte de dialogue ensuite."}
            </p>
          </div>

          {thermal && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-subtle p-4">
              {((settings.driver === "serial" && !serialOk) || (settings.driver === "usb" && !usbOk)) && (
                <Callout tone="warning" title="Non disponible sur ce navigateur">Utilisez Chrome ou Edge sur ordinateur ou tablette Android, ou repassez au pilote « Navigateur ».</Callout>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{paired ? <>Imprimante : <strong>{paired}</strong></> : "Aucune imprimante autorisée"}</span>
                <Button variant="secondary" onClick={() => void connect()} disabled={busy || (settings.driver === "serial" ? !serialOk : !usbOk)}>{paired ? "Changer d'imprimante" : "Connecter une imprimante"}</Button>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Largeur du papier</span>
                <Segmented ariaLabel="Largeur du papier" size="sm" value={String(settings.columns)} onChange={(v) => update({ columns: Number(v) as 32 | 42 | 48 })}
                  options={[{ value: "48", label: "80 mm" }, { value: "42", label: "80 mm étroit" }, { value: "32", label: "58 mm" }]} />
              </div>
              {settings.driver === "serial" && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Vitesse du port</span>
                  <Segmented ariaLabel="Vitesse du port série" size="sm" value={String(settings.baudRate)} onChange={(v) => update({ baudRate: Number(v) })}
                    options={[{ value: "9600", label: "9 600" }, { value: "19200", label: "19 200" }, { value: "115200", label: "115 200" }]} />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            <label className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
              <span className="flex flex-col"><span className="text-sm font-medium">Imprimer le ticket cuisine automatiquement</span><span className="text-[13px] text-muted-foreground">À chaque commande créée sur cet appareil, même hors ligne.</span></span>
              <Switch checked={settings.autoKitchen} onCheckedChange={(autoKitchen) => update({ autoKitchen })} aria-label="Ticket cuisine automatique" />
            </label>
            <label className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
              <span className="flex flex-col"><span className="text-sm font-medium">Imprimer aussi le ticket caisse</span><span className="text-[13px] text-muted-foreground">À la création de la commande (utile pour l'emporter).</span></span>
              <Switch checked={settings.autoReceipt} onCheckedChange={(autoReceipt) => update({ autoReceipt })} aria-label="Ticket caisse automatique" />
            </label>
            <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm font-medium" id="copies-label">Exemplaires</span>
              <Segmented ariaLabel="Nombre d'exemplaires" size="sm" value={String(settings.copies)} onChange={(v) => update({ copies: Number(v) as 1 | 2 | 3 })}
                options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }]} />
            </div>
          </div>
          <div><Button variant="secondary" onClick={() => void test()} loading={busy}><Printer /> Imprimer un ticket de test</Button></div>
        </div>
      </SettingsSection>
    </div>
  );
}
