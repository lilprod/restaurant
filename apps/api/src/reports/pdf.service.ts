import { Injectable } from "@nestjs/common";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { fmtDec, fmtInt, fmtMoney, fmtPct, type Cell, type ColType, type ReportDoc, type Section } from "./report-doc";

/** Marque appliquée aux documents : nom, couleur principale, logo (PNG/JPEG) et lignes de coordonnées. */
export interface PdfBrand {
  name: string;
  primary?: string | null;
  logo?: Buffer | null;
  /** Une ligne par entrée : adresse, téléphone, email, NIF… */
  lines: string[];
}

const FONT_DIR = join(__dirname, "fonts");
const INK = "#111827", MUTED = "#6B7280", LINE = "#E5E7EB", TINT = "#F3F4F6";
const MAX_PDF_ROWS = 300;

const safeColor = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : "#111827");

/** Valeur d'une cellule pour l'affichage (PDF). */
export function showCell(v: Cell, type: ColType = "text"): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  switch (type) {
    case "money": case "int": return fmtInt(v);
    case "percent": return fmtPct(v);
    case "decimal": return Number.isInteger(v) ? fmtInt(v) : fmtDec(v, 2).replace(/,?0+$/, "");
    default: return String(v);
  }
}

/**
 * Génération PDF côté API (pdfkit, polices Lato embarquées — pas de dépendance à une police système).
 * Trois gabarits : rapport tabulaire, facture d'une commande, reçu d'un paiement de licence.
 */
@Injectable()
export class PdfService {
  private create(opts: { landscape?: boolean; title: string; author: string; margin?: number }) {
    const doc = new PDFDocument({
      size: "A4", layout: opts.landscape ? "landscape" : "portrait", margin: opts.margin ?? 40, bufferPages: true,
      info: { Title: opts.title, Author: opts.author, Creator: "Gestion Restaurant" },
    });
    doc.registerFont("Body", join(FONT_DIR, "lato-latin-400-normal.woff"));
    doc.registerFont("Bold", join(FONT_DIR, "lato-latin-700-normal.woff"));
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
    return { doc, done };
  }

  /** Numérote les pages et signe le pied de chaque page (à appeler en dernier). */
  private footers(doc: PDFKit.PDFDocument, left: string) {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const m = doc.page.margins;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 28, w = doc.page.width - m.left - m.right;
      doc.font("Body").fontSize(8).fillColor(MUTED);
      doc.text(left, m.left, y, { width: w * 0.8, lineBreak: false });
      doc.text(`Page ${i + 1} / ${range.count}`, m.left, y, { width: w, align: "right", lineBreak: false });
    }
  }

  /** En-tête de marque : logo, nom, coordonnées ; renvoie l'ordonnée sous l'en-tête. */
  private brandHeader(doc: PDFKit.PDFDocument, brand: PdfBrand, right?: (x: number, w: number) => void): number {
    const m = doc.page.margins.left, top = doc.page.margins.top, width = doc.page.width - 2 * m;
    let x = m;
    if (brand.logo) {
      try { doc.image(brand.logo, m, top, { fit: [64, 44] }); x = m + 76; } catch { /* logo illisible (format non pris en charge) : en-tête sans logo */ }
    }
    doc.font("Bold").fontSize(15).fillColor(INK).text(brand.name, x, top, { width: width * 0.6, lineBreak: false });
    doc.font("Body").fontSize(8.5).fillColor(MUTED);
    let y = top + 21;
    for (const l of brand.lines.slice(0, 5)) { doc.text(l, x, y, { width: width * 0.6, lineBreak: false }); y += 11; }
    right?.(m + width * 0.6, width * 0.4);
    y = Math.max(y, top + 48) + 8;
    doc.save().rect(m, y, width, 2).fill(safeColor(brand.primary)).restore();
    return y + 14;
  }

  // ── Rapport tabulaire ──

  async report(d: ReportDoc, brand: PdfBrand, generatedAt: string): Promise<Buffer> {
    const wide = d.sections.some((s) => s.columns.length > 7);
    const { doc, done } = this.create({ landscape: wide, title: d.title, author: brand.name });
    const m = doc.page.margins.left, width = doc.page.width - 2 * m;
    const color = safeColor(brand.primary);
    let y = this.brandHeader(doc, brand);

    doc.font("Bold").fontSize(18).fillColor(INK).text(d.title, m, y, { width, lineBreak: false });
    doc.font("Body").fontSize(10).fillColor(MUTED).text(d.subtitle, m, y + 24, { width, lineBreak: false });
    y += 46;

    if (d.kpis?.length) {
      const per = Math.min(d.kpis.length, 4), gap = 10, w = (width - gap * (per - 1)) / per;
      d.kpis.slice(0, 4).forEach((k, i) => {
        const x = m + i * (w + gap);
        doc.save().roundedRect(x, y, w, 46, 4).fill(TINT).restore();
        doc.font("Body").fontSize(8).fillColor(MUTED).text(k.label, x + 8, y + 7, { width: w - 16, lineBreak: false, ellipsis: true });
        doc.font("Bold").fontSize(11).fillColor(INK).text(k.value, x + 8, y + 22, { width: w - 16, lineBreak: false, ellipsis: true });
      });
      y += 60;
    }

    for (const s of d.sections) y = this.table(doc, s, y, color);
    this.footers(doc, `${brand.name} · ${d.title} · généré le ${generatedAt}`);
    doc.end();
    return done;
  }

  private table(doc: PDFKit.PDFDocument, s: Section, startY: number, color: string): number {
    const m = doc.page.margins.left, width = doc.page.width - 2 * m, rowH = 17;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 24;
    const cols = s.columns;
    const rows = s.rows.slice(0, MAX_PDF_ROWS);

    // Largeurs : proportionnelles au contenu, bornées, ajustées à la largeur utile (colonnes de texte d'abord).
    const len = cols.map((c, i) => Math.min(34, Math.max(c.label.length * 0.8, ...rows.concat(s.total ? [s.total] : []).map((r) => showCell(r[i], c.type).length))));
    const raw = len.map((l, i) => Math.max(cols[i].type && cols[i].type !== "text" ? 46 : 70, l * 5 + 14));
    const sum = raw.reduce((a, b) => a + b, 0);
    let w = raw;
    if (sum > width) w = raw.map((x) => (x * width) / sum);
    else {
      const text = cols.map((c, i) => (!c.type || c.type === "text" ? i : -1)).filter((i) => i >= 0);
      const idx = text.length ? text : cols.map((_, i) => i);
      w = raw.map((x, i) => (idx.includes(i) ? x + (width - sum) / idx.length : x));
    }

    const head = (y: number) => {
      doc.save().rect(m, y, width, rowH + 2).fill(TINT).restore();
      doc.save().rect(m, y + rowH + 2, width, 1.2).fill(color).restore();
      let x = m;
      cols.forEach((c, i) => {
        doc.font("Bold").fontSize(8).fillColor(INK).text(c.label, x + 4, y + 5, { width: w[i] - 8, align: !c.type || c.type === "text" ? "left" : "right", lineBreak: false, ellipsis: true });
        x += w[i];
      });
      return y + rowH + 4;
    };
    const line = (cells: Cell[], y: number, bold: boolean, zebra: boolean) => {
      if (zebra) doc.save().rect(m, y, width, rowH).fill("#FAFAFA").restore();
      let x = m;
      cols.forEach((c, i) => {
        doc.font(bold ? "Bold" : "Body").fontSize(8.5).fillColor(INK).text(showCell(cells[i], c.type), x + 4, y + 4.5, { width: w[i] - 8, align: !c.type || c.type === "text" ? "left" : "right", lineBreak: false, ellipsis: true });
        x += w[i];
      });
    };

    if (startY + 46 > bottom()) { doc.addPage(); startY = doc.page.margins.top; }
    doc.font("Bold").fontSize(11).fillColor(INK).text(s.title, m, startY, { width, lineBreak: false });
    let y = head(startY + 20);
    rows.forEach((r, n) => {
      if (y + rowH > bottom()) { doc.addPage(); y = head(doc.page.margins.top); }
      line(r, y, false, n % 2 === 1);
      y += rowH;
    });
    if (s.rows.length > rows.length) {
      doc.font("Body").fontSize(8).fillColor(MUTED).text(`… ${fmtInt(s.rows.length - rows.length)} ligne(s) de plus : utilisez l'export CSV pour le détail complet.`, m + 4, y + 4, { width, lineBreak: false });
      y += rowH;
    }
    if (!rows.length) { doc.font("Body").fontSize(9).fillColor(MUTED).text("Aucune donnée sur la période.", m + 4, y + 4, { width, lineBreak: false }); y += rowH; }
    if (s.total) {
      if (y + rowH > bottom()) { doc.addPage(); y = doc.page.margins.top; }
      doc.save().rect(m, y, width, 0.8).fill(INK).restore();
      line(s.total, y + 1, true, false);
      y += rowH + 1;
    }
    return y + 20;
  }

  // ── Facture d'une commande ──

  async invoice(d: InvoiceData): Promise<Buffer> {
    const { doc, done } = this.create({ title: `Facture ${d.number}`, author: d.brand.name, margin: 48 });
    const m = 48, width = doc.page.width - 2 * m;
    const color = safeColor(d.brand.primary);
    let y = this.brandHeader(doc, d.brand, (x, w) => {
      doc.font("Bold").fontSize(22).fillColor(color).text("FACTURE", x, doc.page.margins.top - 2, { width: w, align: "right", lineBreak: false });
      doc.font("Bold").fontSize(10).fillColor(INK).text(`N° ${d.number}`, x, doc.page.margins.top + 26, { width: w, align: "right", lineBreak: false });
      doc.font("Body").fontSize(9).fillColor(MUTED).text(d.date, x, doc.page.margins.top + 40, { width: w, align: "right", lineBreak: false });
    });

    const info: [string, string][] = ([["Commande", `n° ${d.orderNumber}`], ["Type", d.type], ["Table", d.table], ["Serveur", d.waiter], ["Client", d.customer]] as [string, string][]).filter(([, v]) => v);
    doc.font("Body").fontSize(9);
    info.forEach(([k, v], i) => {
      const x = m + (i % 3) * (width / 3), yy = y + Math.floor(i / 3) * 26;
      doc.fillColor(MUTED).text(k.toUpperCase(), x, yy, { width: width / 3 - 8, lineBreak: false });
      doc.font("Bold").fillColor(INK).text(v, x, yy + 11, { width: width / 3 - 8, lineBreak: false, ellipsis: true }).font("Body");
    });
    y += Math.ceil(info.length / 3) * 26 + 10;

    // Lignes
    const cw = [width - 60 - 85 - 50 - 95, 60, 85, 50, 95];
    const head = (yy: number) => {
      doc.save().rect(m, yy, width, 20).fill(TINT).restore();
      doc.save().rect(m, yy + 20, width, 1.2).fill(color).restore();
      let x = m;
      ["Désignation", "Qté", "Prix unit. TTC", "TVA", "Total TTC"].forEach((h, i) => {
        doc.font("Bold").fontSize(8.5).fillColor(INK).text(h, x + 5, yy + 6, { width: cw[i] - 10, align: i ? "right" : "left", lineBreak: false });
        x += cw[i];
      });
      return yy + 24;
    };
    y = head(y);
    for (const l of d.lines) {
      if (y + 18 > doc.page.height - 120) { doc.addPage(); y = head(doc.page.margins.top); }
      const cells = l.child ? [`   · ${l.label}`, "", "", "", ""] : [l.label, String(l.quantity), fmtInt(l.unitPrice), `${fmtDec(l.vatRate, 1).replace(",0", "")} %`, fmtInt(l.total)];
      let x = m;
      cells.forEach((c, i) => {
        doc.font(l.child ? "Body" : "Body").fontSize(l.child ? 8 : 9).fillColor(l.child ? MUTED : INK).text(c, x + 5, y + 3, { width: cw[i] - 10, align: i ? "right" : "left", lineBreak: false, ellipsis: true });
        x += cw[i];
      });
      doc.save().rect(m, y + 16, width, 0.5).fill(LINE).restore();
      y += 18;
    }

    // Totaux
    if (y + 190 > doc.page.height - 60) { doc.addPage(); y = doc.page.margins.top; }
    y += 10;
    const tx = m + width - 230, tw = 230;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Bold" : "Body").fontSize(bold ? 11 : 9.5).fillColor(INK).text(label, tx, y, { width: tw - 110, lineBreak: false });
      doc.text(value, tx + tw - 110, y, { width: 110, align: "right", lineBreak: false });
      y += bold ? 20 : 15;
    };
    row("Sous-total TTC", fmtMoney(d.subtotal));
    if (d.discounts) row("Dont remises appliquées", fmtMoney(d.discounts));
    if (d.serviceCharge) row("Service", fmtMoney(d.serviceCharge));
    if (d.deliveryFee) row("Frais de livraison", fmtMoney(d.deliveryFee));
    doc.save().rect(tx, y, tw, 0.8).fill(INK).restore(); y += 5;
    row("TOTAL TTC", fmtMoney(d.total), true);
    for (const v of d.vat) row(`Dont TVA ${fmtDec(v.rate, 1).replace(",0", "")} % (base ${fmtInt(v.base)})`, fmtMoney(v.vat));
    if (d.tip) row("Pourboire", fmtMoney(d.tip));
    y += 6;
    for (const p of d.payments) row(`Réglé · ${p.label}`, fmtMoney(p.amount));
    row(d.remaining > 0 ? "Reste à payer" : "Facture acquittée", d.remaining > 0 ? fmtMoney(d.remaining) : fmtMoney(0), true);

    // Mentions
    y += 14;
    doc.font("Body").fontSize(8).fillColor(MUTED);
    for (const t of d.mentions) { doc.text(t, m, y, { width, lineBreak: true }); y = doc.y + 3; }
    this.footers(doc, `${d.brand.name} · Facture ${d.number}`);
    doc.end();
    return done;
  }

  // ── Reçu d'un paiement de licence ──

  async licenseReceipt(d: LicenseReceiptData): Promise<Buffer> {
    const { doc, done } = this.create({ title: `Reçu ${d.number}`, author: d.brand.name, margin: 48 });
    const m = 48, width = doc.page.width - 2 * m;
    const color = safeColor(d.brand.primary);
    let y = this.brandHeader(doc, d.brand, (x, w) => {
      doc.font("Bold").fontSize(20).fillColor(color).text("REÇU", x, doc.page.margins.top - 2, { width: w, align: "right", lineBreak: false });
      doc.font("Bold").fontSize(10).fillColor(INK).text(`N° ${d.number}`, x, doc.page.margins.top + 24, { width: w, align: "right", lineBreak: false });
      doc.font("Body").fontSize(9).fillColor(MUTED).text(d.date, x, doc.page.margins.top + 38, { width: w, align: "right", lineBreak: false });
    });

    doc.font("Bold").fontSize(13).fillColor(INK).text("Paiement de licence", m, y, { width, lineBreak: false });
    y += 28;
    doc.font("Body").fontSize(8.5).fillColor(MUTED).text("REÇU DE", m, y, { lineBreak: false });
    doc.font("Bold").fontSize(11).fillColor(INK).text(d.customer.name, m, y + 12, { width, lineBreak: false });
    if (d.customer.email) doc.font("Body").fontSize(9).fillColor(MUTED).text(d.customer.email, m, y + 27, { width, lineBreak: false });
    y += 56;

    const rows: [string, string][] = [
      ["Plan", d.plan], ["Cycle de facturation", d.cycle], ["Période couverte", d.period], ["Mode de paiement", d.method], ["Référence", d.reference ?? "—"],
    ];
    for (const [k, v] of rows) {
      doc.font("Body").fontSize(9.5).fillColor(MUTED).text(k, m, y, { width: 170, lineBreak: false });
      doc.font("Bold").fillColor(INK).text(v, m + 180, y, { width: width - 180, lineBreak: false, ellipsis: true });
      doc.save().rect(m, y + 17, width, 0.5).fill(LINE).restore();
      y += 25;
    }
    y += 12;
    doc.save().roundedRect(m, y, width, 56, 6).fill(TINT).restore();
    doc.font("Body").fontSize(9).fillColor(MUTED).text("MONTANT RÉGLÉ", m + 16, y + 12, { lineBreak: false });
    doc.font("Bold").fontSize(20).fillColor(INK).text(fmtMoney(d.amount), m + 16, y + 26, { width: width - 32, lineBreak: false });
    y += 76;
    if (d.voided) {
      doc.font("Bold").fontSize(11).fillColor("#B91C1C").text(`PAIEMENT ANNULÉ${d.voided.reason ? ` — ${d.voided.reason}` : ""}`, m, y, { width });
      y = doc.y + 8;
    }
    doc.font("Body").fontSize(8).fillColor(MUTED);
    for (const t of d.mentions) { doc.text(t, m, y, { width }); y = doc.y + 3; }
    this.footers(doc, `${d.brand.name} · Reçu ${d.number}`);
    doc.end();
    return done;
  }
}

export interface InvoiceData {
  brand: PdfBrand;
  number: string;
  date: string;
  orderNumber: number;
  type: string;
  table: string;
  waiter: string;
  customer: string;
  lines: { label: string; quantity: number; unitPrice: number; vatRate: number; total: number; child?: boolean }[];
  subtotal: number;
  discounts: number;
  serviceCharge: number;
  deliveryFee: number;
  total: number;
  tip: number;
  vat: { rate: number; base: number; vat: number }[];
  payments: { label: string; amount: number }[];
  remaining: number;
  mentions: string[];
}

export interface LicenseReceiptData {
  brand: PdfBrand;
  number: string;
  date: string;
  customer: { name: string; email?: string | null };
  plan: string;
  cycle: string;
  period: string;
  method: string;
  reference: string | null;
  amount: number;
  voided: { reason: string | null } | null;
  mentions: string[];
}
