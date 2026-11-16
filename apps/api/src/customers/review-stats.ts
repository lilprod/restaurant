import type { Tx } from "../prisma/prisma.service";

export interface ReviewSummary {
  count: number;
  /** Moyenne sur 5, arrondie à une décimale (null sans avis). */
  average: number | null;
  /** Nombre d'avis par note, de 1 à 5. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** Moyenne et répartition des notes d'un restaurant (`visibleOnly` : avis non masqués, ce que voit le public ; `range` : avis déposés dans la période). */
export async function reviewSummary(tx: Tx, tenantId: string, visibleOnly: boolean, range?: { start: Date; end: Date }): Promise<ReviewSummary> {
  const rows = await tx.feedback.groupBy({
    by: ["rating"], _count: { _all: true },
    where: { tenantId, ...(visibleOnly ? { hiddenAt: null } : {}), ...(range ? { createdAt: { gte: range.start, lt: range.end } } : {}) },
  });
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as ReviewSummary["distribution"];
  for (const r of rows) if (r.rating >= 1 && r.rating <= 5) distribution[r.rating as 1 | 2 | 3 | 4 | 5] = r._count._all;
  return summarize(distribution);
}

export function summarize(distribution: ReviewSummary["distribution"]): ReviewSummary {
  const count = Object.values(distribution).reduce((a, b) => a + b, 0);
  const sum = ([1, 2, 3, 4, 5] as const).reduce((n, k) => n + k * distribution[k], 0);
  return { count, average: count ? Math.round((sum / count) * 10) / 10 : null, distribution };
}
