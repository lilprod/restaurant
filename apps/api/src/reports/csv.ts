import type { Cell, ReportDoc } from "./report-doc";

export const CSV_BOM = "﻿";

/**
 * Cellule CSV (séparateur « ; », virgule décimale). Un texte qui commencerait par `= + - @` (ou tabulation / retour chariot,
 * éventuellement après des espaces) est préfixé d'une apostrophe : un tableur ne l'interprète jamais comme une formule.
 * Les nombres, eux, sont écrits tels quels (un négatif légitime reste un nombre).
 */
export function csvCell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v).replace(".", ",") : "";
  const s = /^\s*[=+\-@]|^[\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(s) || s !== v ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: Cell[]) => `${cells.map(csvCell).join(";")}\r\n`;

/** Rapport complet : sections successives, séparées d'une ligne vide, chacune avec son titre, ses en-têtes et son total. */
export function docToCsv(doc: ReportDoc): string {
  let out = CSV_BOM + csvLine([doc.title]) + csvLine([doc.subtitle]);
  if (doc.kpis?.length) out += `\r\n${doc.kpis.map((k) => csvLine([k.label, k.value])).join("")}`;
  for (const s of doc.sections) {
    out += `\r\n${csvLine([s.title])}${csvLine(s.columns.map((c) => c.label))}${s.rows.map(csvLine).join("")}`;
    if (s.total) out += csvLine(s.total);
  }
  return out;
}
