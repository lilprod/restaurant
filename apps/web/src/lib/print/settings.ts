/** Réglages d'impression PROPRES À CET APPAREIL (localStorage, par restaurant) : une tablette de cuisine n'a pas la même imprimante que la caisse. */
export type PrinterDriverKind = "browser" | "serial" | "usb";

export interface PrintSettings {
  driver: PrinterDriverKind;
  /** Imprime le ticket cuisine dès qu'une commande est créée (ou saisie hors ligne) sur cet appareil. */
  autoKitchen: boolean;
  /** Imprime aussi le ticket caisse à la création (utile pour l'emporter). */
  autoReceipt: boolean;
  copies: 1 | 2 | 3;
  /** Largeur de l'imprimante thermique : caractères par ligne. */
  columns: 32 | 42 | 48;
  baudRate: number;
  /** Imprimante mémorisée (identifiants USB), pour la retrouver sans nouvelle autorisation. */
  serialPort?: { usbVendorId?: number; usbProductId?: number; label?: string };
  usbDevice?: { vendorId: number; productId: number; label?: string };
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { driver: "browser", autoKitchen: false, autoReceipt: false, copies: 1, columns: 48, baudRate: 9600 };

const key = (slug: string) => `restaurant.print.${slug}`;

function read(slug: string): PrintSettings {
  try {
    const raw = localStorage.getItem(key(slug));
    return raw ? { ...DEFAULT_PRINT_SETTINGS, ...(JSON.parse(raw) as Partial<PrintSettings>) } : { ...DEFAULT_PRINT_SETTINGS };
  } catch { return { ...DEFAULT_PRINT_SETTINGS }; }
}

// Petit magasin observable (useSyncExternalStore) : tous les écrans voient le même réglage.
const cache = new Map<string, PrintSettings>();
const listeners = new Set<() => void>();

export function loadPrintSettings(slug: string): PrintSettings {
  let v = cache.get(slug);
  if (!v) { v = read(slug); cache.set(slug, v); }
  return v;
}
export function updatePrintSettings(slug: string, patch: Partial<PrintSettings>) {
  const next = { ...loadPrintSettings(slug), ...patch };
  cache.set(slug, next);
  try { localStorage.setItem(key(slug), JSON.stringify(next)); } catch { /* stockage indisponible : réglage perdu au rechargement */ }
  for (const l of [...listeners]) l();
}
export function subscribePrintSettings(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
