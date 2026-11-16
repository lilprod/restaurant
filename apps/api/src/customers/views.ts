import type { Prisma } from "@prisma/client";

export const ORDER_TYPES: Record<string, string> = { DINE_IN: "Sur place", TAKEAWAY: "À emporter", DELIVERY: "Livraison" };

export const reviewInclude = {
  order: { select: { id: true, number: true, type: true } },
  customer: { select: { firstName: true } },
} satisfies Prisma.FeedbackInclude;
export type ReviewRow = Prisma.FeedbackGetPayload<{ include: typeof reviewInclude }>;

/** Nom affiché avec l'avis : celui saisi, sinon le prénom du compte, sinon « Client ». */
export const reviewAuthor = (r: Pick<ReviewRow, "authorName" | "customer">) => r.authorName || r.customer?.firstName || "Client";

/** Forme d'un avis côté restaurant (responsables). */
export function reviewView(r: ReviewRow) {
  return {
    id: r.id, rating: r.rating, comment: r.comment, author: reviewAuthor(r), hasAccount: !!r.customerId,
    order: r.order, hidden: !!r.hiddenAt, hiddenAt: r.hiddenAt,
    reply: r.reply, repliedAt: r.repliedAt, createdAt: r.createdAt,
  };
}
export type ReviewView = ReturnType<typeof reviewView>;

/** Forme publique d'un avis (carte publique) : ni commande, ni compte. */
export function publicReviewView(r: ReviewRow) {
  return { id: r.id, rating: r.rating, comment: r.comment, author: reviewAuthor(r), reply: r.reply, repliedAt: r.repliedAt, createdAt: r.createdAt };
}
