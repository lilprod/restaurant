import { Injectable } from "@nestjs/common";
import type { ReportPeriodQuery } from "@restaurant/validation";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { TenantSettingsService } from "../settings/tenant-settings.service";
import { CSV_BOM, csvLine } from "./csv";
import { rangeOf } from "./period";
import { STATUS_LABEL, TYPE_LABEL } from "./report-doc";

const BATCH = 1000;

/** Export CSV du détail des commandes, **en flux** : lecture par lots (curseur sur l'identifiant), jamais plus d'un lot en mémoire. */
@Injectable()
export class OrdersExportService {
  constructor(private readonly prisma: PrismaService, private readonly settings: TenantSettingsService) {}

  async stream(tenantId: string, p: ReportPeriodQuery): Promise<{ stream: Readable; filename: string }> {
    const tz = (await this.settings.tenant(tenantId)).timezone;
    const { start, end } = rangeOf(p, tz);
    const fmt = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const when = (d: Date | null) => (d ? fmt.format(d).replace(/[  ]/g, " ").replace(",", "") : "");
    const prisma = this.prisma;

    async function* rows() {
      yield CSV_BOM + csvLine([
        "N°", "Date", "Type", "Statut", "Table", "Serveur", "Client", "Sous-total TTC (FCFA)", "Service (FCFA)", "Dont TVA (FCFA)", "Total TTC (FCFA)",
        "Pourboire (FCFA)", "Encaissé (FCFA)", "Paiement", "Annulée le", "Motif d'annulation",
      ]);
      let cursor: string | undefined;
      for (;;) {
        const batch = await prisma.asTenant(tenantId, (tx) => tx.order.findMany({
          where: { tenantId, createdAt: { gte: start, lt: end } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: {
            id: true, number: true, createdAt: true, type: true, status: true, customerName: true, subtotal: true, serviceCharge: true, vat: true, total: true,
            tip: true, paidAmount: true, paymentStatus: true, cancelledAt: true, cancelReason: true,
            table: { select: { label: true } }, waiter: { select: { firstName: true, lastName: true } },
          },
        }));
        if (!batch.length) return;
        yield batch.map((o) => csvLine([
          o.number, when(o.createdAt), TYPE_LABEL[o.type] ?? o.type, STATUS_LABEL[o.status] ?? o.status, o.table?.label ?? "",
          o.waiter ? `${o.waiter.firstName} ${o.waiter.lastName}`.trim() : "", o.customerName ?? "",
          o.subtotal, o.serviceCharge, o.vat, o.total, o.tip, o.paidAmount,
          o.paymentStatus === "PAID" ? "Payée" : o.paymentStatus === "PARTIAL" ? "Partielle" : "Non payée", when(o.cancelledAt), o.cancelReason ?? "",
        ])).join("");
        cursor = batch[batch.length - 1].id;
        if (batch.length < BATCH) return;
      }
    }
    return { stream: Readable.from(rows(), { objectMode: false }), filename: `commandes-${p.from}${p.to === p.from ? "" : `_${p.to}`}.csv` };
  }
}
