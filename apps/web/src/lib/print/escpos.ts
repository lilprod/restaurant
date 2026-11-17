import type { TicketDoc, TicketLine } from "./ticket-doc";

/**
 * Encodeur ESC/POS générique (imprimantes thermiques 80 mm / 58 mm). Jeu de caractères CP858 (français + €),
 * choisi par `ESC t 19`. Aucune dépendance : le résultat est un `Uint8Array` à envoyer tel quel à l'imprimante.
 */
export interface EscposOptions {
  /** Caractères par ligne en taille normale : 48 (80 mm, police A), 42 (80 mm, police B/étroite), 32 (58 mm). */
  columns?: 32 | 42 | 48;
  /** Coupe du papier en fin de ticket. */
  cut?: boolean;
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

/** Unicode → octet CP858 pour les caractères non ASCII utiles en français. */
const CP858: Record<string, number> = {
  "Ç": 0x80, "ü": 0x81, "é": 0x82, "â": 0x83, "ä": 0x84, "à": 0x85, "ç": 0x87, "ê": 0x88, "ë": 0x89, "è": 0x8a, "ï": 0x8b, "î": 0x8c,
  "É": 0x90, "ô": 0x93, "ö": 0x94, "û": 0x96, "ù": 0x97, "Ü": 0x9a, "«": 0xae, "»": 0xaf, "À": 0xb7, "Â": 0xb6, "Ê": 0xd2, "Ë": 0xd3,
  "È": 0xd4, "€": 0xd5, "Î": 0xd7, "Ï": 0xd8, "Ô": 0xe2, "Ù": 0xeb, "Û": 0xea, "°": 0xf8, "·": 0xfa, "ÿ": 0x98,
};
const SUBST: Record<string, string> = {
  "œ": "oe", "Œ": "OE", "×": "x", "–": "-", "—": "-", "−": "-", "’": "'", "‘": "'", "“": '"', "”": '"', "…": "...", " ": " ", " ": " ",
};

export function encodeText(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const sub = SUBST[ch];
    for (const c of sub ?? ch) {
      const code = c.codePointAt(0)!;
      if (code >= 0x20 && code < 0x7f) out.push(code);
      else if (CP858[c] !== undefined) out.push(CP858[c]!);
      else out.push(0x3f);                                   // « ? » : caractère absent de la page de codes
    }
  }
  return out;
}

const mult = (size: 1 | 2 | 3 | undefined) => size ?? 1;

/** Retour à la ligne par mots, sur `width` caractères. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const word of raw.split(" ")) {
      let w = word;
      while (w.length > width) { if (line) { out.push(line); line = ""; } out.push(w.slice(0, width)); w = w.slice(width); }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

function qr(data: string): number[] {
  const bytes = [...new TextEncoder().encode(data)];
  const len = bytes.length + 3;
  return [
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0,           // modèle 2
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 5,                  // taille de module 5
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31,               // correction d'erreur M
    GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...bytes,   // données
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30,               // impression
  ];
}

export function encodeEscpos(doc: TicketDoc, { columns = 48, cut = true }: EscposOptions = {}): Uint8Array {
  const o: number[] = [ESC, 0x40, ESC, 0x74, 19];          // initialisation, page de codes CP858
  const style = (bold: boolean, size: number) => o.push(ESC, 0x45, bold ? 1 : 0, GS, 0x21, ((size - 1) << 4) | (size - 1));
  const align = (a: "left" | "center" | "right") => o.push(ESC, 0x61, a === "center" ? 1 : a === "right" ? 2 : 0);

  for (const l of doc.lines as TicketLine[]) {
    switch (l.t) {
      case "text": {
        const size = mult(l.size);
        align(l.align ?? "left"); style(!!l.bold, size);
        for (const row of wrap(l.text, Math.floor(columns / size))) o.push(...encodeText(row), LF);
        break;
      }
      case "pair": {
        const size = mult(l.size);
        const w = Math.floor(columns / size);
        align("left"); style(!!l.bold, size);
        const room = w - l.right.length - 1;
        const left = l.left.length > room ? wrap(l.left, Math.max(8, room)) : [l.left];
        left.forEach((row, idx) => {
          const last = idx === left.length - 1;
          o.push(...encodeText(last ? row + " ".repeat(Math.max(1, w - row.length - l.right.length)) + l.right : row), LF);
        });
        break;
      }
      case "rule":
        align("left"); style(false, 1);
        o.push(...encodeText((l.char ?? "-").repeat(columns)), LF);
        break;
      case "feed":
        o.push(ESC, 0x64, Math.min(255, l.lines));
        break;
      case "qr":
        align("center"); style(false, 1);
        o.push(...qr(l.data), LF);
        break;
    }
  }
  style(false, 1); align("left");
  if (cut) o.push(GS, 0x56, 0x42, 0);                       // coupe partielle avec avance du papier
  return Uint8Array.from(o);
}
