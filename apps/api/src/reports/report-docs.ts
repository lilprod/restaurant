import type { ReportsService } from "./reports.service";
import { METHOD_LABEL, dateTimeFr, TYPE_LABEL, WEEKDAY_LABEL, dayFr, delta, fmtMoney, fmtPct, fmtInt, periodLabel, type ReportDoc } from "./report-doc";

type Period = { from: string; to: string };
const pctText = (d: number | null) => (d == null ? "—" : `${d > 0 ? "+" : ""}${String(d).replace(".", ",")} %`);

/** Construit le modèle d'un rapport (CSV et PDF) à partir des mêmes données que l'écran. */
export async function buildReportDoc(kind: Exclude<import("@restaurant/validation").ReportKind, "orders">, svc: ReportsService, tenantId: string, p: Period): Promise<ReportDoc> {
  const subtitle = periodLabel(p.from, p.to);
  switch (kind) {
    case "sales": {
      const r = await svc.sales(tenantId, p);
      const s = r.summary, b = r.previous.summary;
      return {
        title: "Rapport des ventes", subtitle: `${subtitle} · comparé à ${periodLabel(r.previous.from, r.previous.to).toLowerCase()}`,
        kpis: [
          { label: "Chiffre d'affaires encaissé", value: `${fmtMoney(s.revenue)} (${pctText(delta(s.revenue, b.revenue))})` },
          { label: "Commandes", value: `${fmtInt(s.ordersCount)} (${pctText(delta(s.ordersCount, b.ordersCount))})` },
          { label: "Ticket moyen", value: `${fmtMoney(s.averageTicket)} (${pctText(delta(s.averageTicket, b.averageTicket))})` },
          { label: "Pourboires", value: fmtMoney(s.tips) },
        ],
        sections: [
          {
            title: "Synthèse", columns: [{ label: "Indicateur" }, { label: "Période", type: "money" }, { label: "Période précédente", type: "money" }, { label: "Variation (%)", type: "decimal" }],
            rows: ([
              ["Chiffre d'affaires encaissé (FCFA)", s.revenue, b.revenue], ["Pourboires (FCFA)", s.tips, b.tips], ["Commandes (nombre)", s.ordersCount, b.ordersCount],
              ["Total des commandes (FCFA)", s.ordersTotal, b.ordersTotal], ["Ticket moyen (FCFA)", s.averageTicket, b.averageTicket],
              ["Service (FCFA)", s.serviceCharge, b.serviceCharge], ["Dont TVA (FCFA)", s.vat, b.vat], ["Remises promotionnelles (FCFA)", s.discounts, b.discounts],
              ["Commandes annulées (nombre)", s.cancelledOrders.count, b.cancelledOrders.count], ["Commandes annulées (FCFA)", s.cancelledOrders.amount, b.cancelledOrders.amount],
              ["Articles annulés (FCFA)", s.cancelledItems.amount, b.cancelledItems.amount], ["Remboursements (FCFA)", s.refunds.amount, b.refunds.amount],
            ] as [string, number, number][]).map(([l, a, c]) => [l, a, c, delta(a, c)]),
          },
          { title: "Par catégorie", columns: [{ label: "Catégorie" }, { label: "Quantité", type: "int" }, { label: "Ventes TTC (FCFA)", type: "money" }], rows: r.byCategory.map((c) => [c.name, c.quantity, c.amount]), total: ["Total", r.byCategory.reduce((n, c) => n + c.quantity, 0), s.subtotal] },
          { title: "Par plat", columns: [{ label: "Plat" }, { label: "Catégorie" }, { label: "Quantité", type: "int" }, { label: "Ventes TTC (FCFA)", type: "money" }], rows: r.byItem.map((i) => [i.name, i.category, i.quantity, i.amount]) },
          { title: "Par moyen de paiement", columns: [{ label: "Moyen" }, { label: "Paiements", type: "int" }, { label: "Encaissé (FCFA)", type: "money" }, { label: "Pourboires (FCFA)", type: "money" }], rows: r.byMethod.map((m) => [METHOD_LABEL[m.method] ?? m.method, m.count, m.amount, m.tips]), total: ["Total", r.byMethod.reduce((n, m) => n + m.count, 0), s.revenue, s.tips] },
          { title: "Par type de commande", columns: [{ label: "Type" }, { label: "Commandes", type: "int" }, { label: "Total (FCFA)", type: "money" }], rows: r.byType.map((t) => [TYPE_LABEL[t.type] ?? t.type, t.orders, t.total]), total: ["Total", s.ordersCount, s.ordersTotal] },
          { title: "Par serveur", columns: [{ label: "Serveur" }, { label: "Commandes", type: "int" }, { label: "Total (FCFA)", type: "money" }], rows: r.byWaiter.map((w) => [w.name, w.orders, w.total]) },
          { title: "Par heure", columns: [{ label: "Heure" }, { label: "Commandes", type: "int" }, { label: "Total (FCFA)", type: "money" }], rows: r.byHour.filter((h) => h.orders > 0).map((h) => [`${String(h.hour).padStart(2, "0")}h`, h.orders, h.total]) },
          { title: "Par jour de la semaine", columns: [{ label: "Jour" }, { label: "Commandes", type: "int" }, { label: "Total (FCFA)", type: "money" }], rows: r.byWeekday.map((d) => [WEEKDAY_LABEL[d.weekday - 1], d.orders, d.total]) },
          { title: "Par jour", columns: [{ label: "Jour" }, { label: "Commandes", type: "int" }, { label: "Total des commandes (FCFA)", type: "money" }, { label: "Encaissé (FCFA)", type: "money" }], rows: r.byDay.map((d) => [dayFr(d.day), d.orders, d.ordersTotal, d.revenue]) },
        ],
      };
    }
    case "vat": {
      const r = await svc.vat(tenantId, p);
      return {
        title: "TVA collectée", subtitle: `${subtitle} · ${r.basis}`,
        kpis: [{ label: "TVA collectée", value: fmtMoney(r.totals.vat) }, { label: "Base hors taxes", value: fmtMoney(r.totals.base) }, { label: "Total TTC", value: fmtMoney(r.totals.ttc) }],
        sections: [{
          title: "Par taux", columns: [{ label: "Taux (%)", type: "decimal" }, { label: "Base HT (FCFA)", type: "money" }, { label: "TVA (FCFA)", type: "money" }, { label: "Total TTC (FCFA)", type: "money" }],
          rows: r.rows.map((x) => [x.rate, x.base, x.vat, x.ttc]), total: ["Total", r.totals.base, r.totals.vat, r.totals.ttc],
        }],
      };
    }
    case "register": {
      const r = await svc.register(tenantId, p);
      const d = (x: Date | null) => (x ? dateTimeFr(x, r.timezone) : "");
      return {
        title: "Caisse", subtitle,
        kpis: [{ label: "Sessions", value: String(r.totals.sessions) }, { label: "Écart cumulé", value: fmtMoney(r.totals.difference) }, { label: "Sessions avec écart", value: String(r.totals.withGap) }],
        sections: [{
          title: "Sessions de caisse", columns: [{ label: "Ouverture" }, { label: "Clôture" }, { label: "Ouverte par" }, { label: "Fond (FCFA)", type: "money" }, { label: "Encaissé (FCFA)", type: "money" }, { label: "Espèces attendues (FCFA)", type: "money" }, { label: "Compté (FCFA)", type: "money" }, { label: "Écart (FCFA)", type: "money" }],
          rows: r.rows.map((x) => [d(x.openedAt), d(x.closedAt), x.openedBy, x.opening, x.payments, x.expectedCash, x.closing, x.difference]),
          total: ["Total", "", "", "", r.totals.payments, "", "", r.totals.difference],
        }],
      };
    }
    case "margins": {
      const r = await svc.margins(tenantId, p);
      return {
        title: "Coût matière et marges", subtitle: `${subtitle} · coût = fiche technique actuelle`,
        kpis: [{ label: "Marge brute", value: fmtMoney(r.totals.margin) }, { label: "Taux de marge", value: fmtPct(r.totals.marginRate) }, { label: "Ventes sans fiche technique", value: fmtMoney(r.uncosted.revenue) }],
        sections: [{
          title: "Par plat vendu", columns: [{ label: "Plat" }, { label: "Catégorie" }, { label: "Quantité", type: "int" }, { label: "Ventes TTC (FCFA)", type: "money" }, { label: "Ventes HT (FCFA)", type: "money" }, { label: "Coût matière (FCFA)", type: "money" }, { label: "Marge (FCFA)", type: "money" }, { label: "Taux de marge (%)", type: "decimal" }],
          rows: r.rows.map((x) => [x.name, x.category, x.quantity, x.amount, x.revenueNet, x.hasRecipe ? x.cost : null, x.hasRecipe ? x.margin : null, x.marginRate]),
          total: ["Total (plats avec fiche)", "", "", r.totals.revenue, r.totals.revenueNet, r.totals.cost, r.totals.margin, r.totals.marginRate],
        }],
      };
    }
    case "waste": {
      const r = await svc.waste(tenantId, p);
      return {
        title: "Pertes valorisées", subtitle, kpis: [{ label: "Valeur perdue", value: fmtMoney(r.totals.cost) }, { label: "Déclarations", value: String(r.totals.count) }],
        sections: [
          { title: "Par ingrédient", columns: [{ label: "Ingrédient" }, { label: "Unité" }, { label: "Quantité", type: "decimal" }, { label: "Déclarations", type: "int" }, { label: "Valeur (FCFA)", type: "money" }], rows: r.ingredients.map((i) => [i.name, i.unit, i.quantity, i.count, i.cost]), total: ["Total", "", "", r.totals.count, r.totals.cost] },
          { title: "Par motif", columns: [{ label: "Motif" }, { label: "Déclarations", type: "int" }, { label: "Valeur (FCFA)", type: "money" }], rows: r.reasons.map((x) => [x.reason, x.count, x.cost]) },
        ],
      };
    }
    case "staff": {
      const r = await svc.staffPerformance(tenantId, p);
      return {
        title: "Performances du personnel", subtitle,
        kpis: [{ label: "Encaissé", value: fmtMoney(r.totals.revenue) }, { label: "Commandes", value: String(r.totals.orders) }, { label: "Pourboires", value: fmtMoney(r.totals.tips) }],
        sections: [{
          title: "Classement des serveurs", columns: [{ label: "Rang", type: "int" }, { label: "Nom" }, { label: "Commandes", type: "int" }, { label: "Encaissé (FCFA)", type: "money" }, { label: "Ticket moyen (FCFA)", type: "money" }, { label: "Pourboires (FCFA)", type: "money" }, { label: "Annulations", type: "int" }],
          rows: r.rows.map((x) => [x.rank, x.name, x.orders, x.revenue, x.averageTicket, x.tips, x.cancellations]),
          total: ["", "Total", r.totals.orders, r.totals.revenue, r.totals.averageTicket, r.totals.tips, r.totals.cancellations],
        }],
      };
    }
    case "reviews": {
      const r = await svc.reviews(tenantId, p);
      const dist = r.summary.distribution;
      return {
        title: "Avis des clients", subtitle,
        kpis: [{ label: "Note moyenne", value: r.summary.average == null ? "—" : `${String(r.summary.average).replace(".", ",")} / 5` }, { label: "Avis", value: String(r.summary.count) }, { label: "Avis masqués", value: String(r.hidden) }],
        sections: [
          { title: "Répartition des notes", columns: [{ label: "Note", type: "int" }, { label: "Avis", type: "int" }], rows: ([5, 4, 3, 2, 1] as const).map((n) => [n, dist[n]]), total: ["Total", r.summary.count] },
          { title: "Derniers avis", columns: [{ label: "Date" }, { label: "Commande", type: "int" }, { label: "Note", type: "int" }, { label: "Auteur" }, { label: "Commentaire" }], rows: r.recent.map((x) => [dayFr(x.createdAt.toISOString().slice(0, 10)), x.orderNumber, x.rating, x.authorName ?? "", x.comment ?? ""]) },
        ],
      };
    }
    case "peak-hours": {
      const r = await svc.peakHours(tenantId, p);
      const hours = [...new Set(r.cells.map((c) => c.hour))].sort((a, b) => a - b);
      const at = (wd: number, h: number) => r.cells.find((c) => c.weekday === wd && c.hour === h)?.orders ?? 0;
      return {
        title: "Heures de pointe", subtitle: `${subtitle} · commandes par jour et heure (fuseau ${r.timezone})`,
        kpis: r.top.slice(0, 3).map((c) => ({ label: `${WEEKDAY_LABEL[c.weekday - 1]} ${String(c.hour).padStart(2, "0")}h`, value: `${c.orders} commandes` })),
        sections: [{
          title: "Commandes par jour et par heure", columns: [{ label: "Jour" }, ...hours.map((h) => ({ label: `${String(h).padStart(2, "0")}h`, type: "int" as const })), { label: "Total", type: "int" }],
          rows: WEEKDAY_LABEL.map((d, i) => [d, ...hours.map((h) => at(i + 1, h)), hours.reduce((n, h) => n + at(i + 1, h), 0)]),
          total: ["Total", ...hours.map((h) => WEEKDAY_LABEL.reduce((n, _d, i) => n + at(i + 1, h), 0)), r.totalOrders],
        }],
      };
    }
  }
}
