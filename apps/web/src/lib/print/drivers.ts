import { encodeEscpos } from "./escpos";
import type { PrintSettings } from "./settings";
import type { TicketDoc } from "./ticket-doc";

/** Canal d'écriture vers l'imprimante (Web Serial, WebUSB, ou faux port dans les tests). */
export interface PrintTransport {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

// ── Web Serial ──
export interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: { getWriter(): { write(d: Uint8Array): Promise<void>; releaseLock(): void } } | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
export interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(o?: { filters?: { usbVendorId?: number }[] }): Promise<SerialPortLike>;
}

export function serialTransport(port: SerialPortLike, baudRate: number): PrintTransport {
  let opened = false;
  return {
    async write(data) {
      if (!opened) { await port.open({ baudRate }); opened = true; }
      if (!port.writable) throw new Error("Port série non inscriptible");
      const w = port.writable.getWriter();
      try { for (let i = 0; i < data.length; i += 1024) await w.write(data.slice(i, i + 1024)); } finally { w.releaseLock(); }
    },
    async close() { if (opened) { opened = false; await port.close().catch(() => undefined); } },
  };
}

// ── WebUSB ──
export interface UsbDeviceLike {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName?: string | null;
  configuration: { interfaces: { interfaceNumber: number; alternates: { interfaceClass: number; endpoints: { endpointNumber: number; direction: "in" | "out"; type: string }[] }[] }[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: BufferSource): Promise<unknown>;
}
export interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(o: { filters: { classCode?: number; vendorId?: number }[] }): Promise<UsbDeviceLike>;
}

export function usbTransport(dev: UsbDeviceLike): PrintTransport {
  let endpoint: number | null = null;
  return {
    async write(data) {
      if (endpoint === null) {
        if (!dev.opened) await dev.open();
        if (!dev.configuration) await dev.selectConfiguration(1);
        for (const itf of dev.configuration?.interfaces ?? []) {
          const alt = itf.alternates.find((a) => a.interfaceClass === 7 || a.endpoints.some((e) => e.direction === "out" && e.type === "bulk"));
          const ep = alt?.endpoints.find((e) => e.direction === "out" && e.type === "bulk");
          if (alt && ep) { await dev.claimInterface(itf.interfaceNumber); endpoint = ep.endpointNumber; break; }
        }
        if (endpoint === null) throw new Error("Aucune sortie d'impression trouvée sur ce périphérique USB");
      }
      for (let i = 0; i < data.length; i += 4096) await dev.transferOut(endpoint, data.slice(i, i + 4096));
    },
    async close() { endpoint = null; if (dev.opened) await dev.close().catch(() => undefined); },
  };
}

// ── accès aux API du navigateur (surchargeables dans les tests) ──
export const browserApis = {
  serial: (): SerialLike | undefined => (navigator as unknown as { serial?: SerialLike }).serial,
  usb: (): UsbLike | undefined => (navigator as unknown as { usb?: UsbLike }).usb,
};
export const webSerialSupported = () => !!browserApis.serial();
export const webUsbSupported = () => !!browserApis.usb();

/** Autorise une imprimante (geste de l'utilisateur obligatoire) et retourne ce qu'il faut mémoriser. */
export async function pairSerial(): Promise<NonNullable<PrintSettings["serialPort"]>> {
  const api = browserApis.serial();
  if (!api) throw new Error("Web Serial n'est pas disponible sur ce navigateur (utilisez Chrome ou Edge).");
  const port = await api.requestPort();
  const info = port.getInfo?.() ?? {};
  return { ...info, label: info.usbVendorId ? `Série USB ${info.usbVendorId.toString(16)}:${(info.usbProductId ?? 0).toString(16)}` : "Port série" };
}
export async function pairUsb(): Promise<NonNullable<PrintSettings["usbDevice"]>> {
  const api = browserApis.usb();
  if (!api) throw new Error("WebUSB n'est pas disponible sur ce navigateur (utilisez Chrome ou Edge).");
  const dev = await api.requestDevice({ filters: [{ classCode: 7 }] });
  return { vendorId: dev.vendorId, productId: dev.productId, label: dev.productName ?? `USB ${dev.vendorId.toString(16)}:${dev.productId.toString(16)}` };
}

/** Retrouve le transport de l'imprimante mémorisée (déjà autorisée : pas de nouvelle fenêtre de choix). */
export async function resolveTransport(s: PrintSettings): Promise<PrintTransport> {
  if (s.driver === "serial") {
    const api = browserApis.serial();
    if (!api) throw new Error("Web Serial n'est pas disponible sur ce navigateur.");
    const ports = await api.getPorts();
    const want = s.serialPort;
    const port = ports.find((p) => !want || (p.getInfo?.().usbVendorId === want.usbVendorId && p.getInfo?.().usbProductId === want.usbProductId)) ?? ports[0];
    if (!port) throw new Error("Imprimante non connectée : autorisez-la à nouveau dans « Impression et hors ligne ».");
    return serialTransport(port, s.baudRate);
  }
  if (s.driver === "usb") {
    const api = browserApis.usb();
    if (!api) throw new Error("WebUSB n'est pas disponible sur ce navigateur.");
    const devs = await api.getDevices();
    const want = s.usbDevice;
    const dev = devs.find((d) => !want || (d.vendorId === want.vendorId && d.productId === want.productId)) ?? devs[0];
    if (!dev) throw new Error("Imprimante USB non connectée : autorisez-la à nouveau dans « Impression et hors ligne ».");
    return usbTransport(dev);
  }
  throw new Error("Pilote ESC/POS non sélectionné");
}

/** Envoie un ticket à l'imprimante thermique (copies comprises). */
export async function printEscpos(doc: TicketDoc, s: Pick<PrintSettings, "columns" | "copies">, transport: PrintTransport) {
  const bytes = encodeEscpos(doc, { columns: s.columns });
  try { for (let i = 0; i < s.copies; i++) await transport.write(bytes); } finally { await transport.close(); }
}
