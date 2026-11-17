import { printEscpos, resolveTransport, type PrintTransport } from "./drivers";
import type { PrintSettings } from "./settings";
import type { TicketDoc } from "./ticket-doc";

/** Impression par le navigateur (`window.print`, 80 mm) : fournie par le composant `PrintHost`, monté une fois dans l'application. */
type BrowserPrinter = (doc: TicketDoc, copies: number) => Promise<void>;
let browserPrinter: BrowserPrinter | null = null;
export function registerBrowserPrinter(fn: BrowserPrinter) {
  browserPrinter = fn;
  return () => { if (browserPrinter === fn) browserPrinter = null; };
}

/** Imprime un ticket avec le pilote choisi sur cet appareil. Rejette avec un message en français si l'impression est impossible. */
export async function printTicket(doc: TicketDoc, s: Pick<PrintSettings, "driver" | "columns" | "copies" | "baudRate" | "serialPort" | "usbDevice">, transport?: PrintTransport): Promise<void> {
  if (s.driver === "browser") {
    if (!browserPrinter) throw new Error("L'impression par le navigateur n'est pas disponible ici.");
    await browserPrinter(doc, s.copies);
    return;
  }
  await printEscpos(doc, s, transport ?? await resolveTransport(s as PrintSettings));
}
