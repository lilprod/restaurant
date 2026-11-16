import { csvCell, csvLine, docToCsv } from "./csv";

describe("export CSV", () => {
  it("neutralise l'injection de formule (= + - @, tabulation, retour chariot, espaces en tête)", () => {
    for (const evil of ["=1+1", "+33", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "  =CMD()", '=HYPERLINK("x")']) {
      const out = csvCell(evil);
      expect(out.startsWith('"\'') || out.startsWith("'")).toBe(true);
      expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
    }
  });
  it("laisse intacts les textes sûrs et les nombres (négatifs inclus, virgule décimale)", () => {
    expect(csvCell("Riz sauce")).toBe("Riz sauce");
    expect(csvCell(-100)).toBe("-100");
    expect(csvCell(12.5)).toBe("12,5");
    expect(csvCell(null)).toBe("");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell("a-b")).toBe("a-b");
  });
  it("écrit titre, en-têtes, lignes et total", () => {
    const csv = docToCsv({ title: "T", subtitle: "S", sections: [{ title: "Sec", columns: [{ label: "A" }, { label: "B", type: "money" }], rows: [["x", 1], ["=y", 2]], total: ["Total", 3] }] });
    expect(csv).toBe("﻿T\r\nS\r\n\r\nSec\r\nA;B\r\nx;1\r\n\"'=y\";2\r\nTotal;3\r\n");
    expect(csvLine(["a", 1])).toBe("a;1\r\n");
  });
});
