import QRCode from "qrcode";
import * as React from "react";
import { createPortal } from "react-dom";
import { registerBrowserPrinter } from "@/lib/print/print-service";
import type { TicketDoc, TicketLine } from "@/lib/print/ticket-doc";

const SIZE_PT = { 1: 10, 2: 15, 3: 24 } as const;

/** Rendu HTML d'un ticket (papier 80 mm, police à chasse fixe) : impression navigateur et aperçu. */
export function TicketView({ doc, qr }: { doc: TicketDoc; qr?: Record<string, string> }) {
  return (
    <div className="font-mono" style={{ width: "72mm", color: "#000", background: "#fff", lineHeight: 1.25 }} data-testid={`ticket-${doc.kind}`}>
      {doc.lines.map((l, i) => <Line key={i} line={l} qr={qr} />)}
    </div>
  );
}

function Line({ line, qr }: { line: TicketLine; qr?: Record<string, string> }) {
  switch (line.t) {
    case "text":
      return <div style={{ textAlign: line.align ?? "left", fontWeight: line.bold ? 700 : 400, fontSize: `${SIZE_PT[line.size ?? 1]}pt`, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{line.text}</div>;
    case "pair":
      return <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm", fontWeight: line.bold ? 700 : 400, fontSize: `${SIZE_PT[line.size ?? 1]}pt` }}><span style={{ whiteSpace: "pre-wrap" }}>{line.left}</span><span style={{ whiteSpace: "nowrap" }}>{line.right}</span></div>;
    case "rule":
      return <hr style={{ border: 0, borderTop: `${line.char === "=" ? "2px double" : "1px dashed"} #000`, margin: "1.5mm 0" }} />;
    case "feed":
      return <div style={{ height: `${Math.min(line.lines, 6) * 2}mm` }} />;
    case "qr":
      return qr?.[line.data] ? <img alt="QR code" src={qr[line.data]} style={{ display: "block", margin: "2mm auto", width: "32mm", height: "32mm" }} /> : null;
  }
}

/**
 * Hôte d'impression navigateur : affiche le ticket dans un conteneur invisible à l'écran, qui devient la seule chose
 * imprimée (voir `body[data-print-job]` dans globals.css), puis appelle `window.print()`.
 */
export function PrintHost() {
  const [job, setJob] = React.useState<{ doc: TicketDoc; copies: number; done: () => void } | null>(null);
  const [qr, setQr] = React.useState<Record<string, string>>({});

  React.useEffect(() => registerBrowserPrinter((doc, copies) => new Promise<void>((resolve) => setJob({ doc, copies, done: resolve }))), []);

  React.useEffect(() => {
    if (!job) return;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      delete document.body.dataset.printJob;
      window.removeEventListener("afterprint", finish);
      setJob(null);
      job.done();
    };
    (async () => {
      const codes: Record<string, string> = {};
      for (const l of job.doc.lines) {
        if (l.t === "qr" && !codes[l.data]) {
          const svg = await QRCode.toString(l.data, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).catch(() => "");
          if (svg) codes[l.data] = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        }
      }
      setQr(codes);
      // Deux images d'attente : le ticket doit être dessiné avant que le navigateur ne prépare l'aperçu.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (finished) return;
      document.body.dataset.printJob = "1";
      window.addEventListener("afterprint", finish);
      window.print();
      setTimeout(finish, 1000);                         // certains environnements n'émettent pas « afterprint »
    })();
    return () => { if (!finished) delete document.body.dataset.printJob; };
  }, [job]);

  return createPortal(
    <div id="print-host" aria-hidden="true">
      {job && (
        <>
          <style>{"@media print { @page { size: 80mm auto; margin: 3mm; } }"}</style>
          {Array.from({ length: job.copies }, (_, i) => (
            <div key={i} style={{ breakAfter: i < job.copies - 1 ? "page" : "auto" }}><TicketView doc={job.doc} qr={qr} /></div>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}
