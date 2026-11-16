import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ListMessagesQuery, SendMessageInput } from "@restaurant/validation";
import { PrismaService, Tx } from "../prisma/prisma.service";
import { RealtimeService } from "../realtime/realtime.service";
import { FLOOR, KITCHEN, STAFF } from "../restaurant/common";
import type { Account } from "../security/accounts.repo";

const SYSTEM = [
  { key: "sys:all", name: "Tous", kind: "ALL", roles: STAFF as readonly string[] },
  { key: "sys:floor", name: "Salle", kind: "FLOOR", roles: FLOOR as readonly string[] },
  { key: "sys:kitchen", name: "Cuisine", kind: "KITCHEN", roles: KITCHEN as readonly string[] },
] as const;

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim();
const messageInclude = { sender: { select: { firstName: true, lastName: true } } } as const;
type MessageRow = { id: string; channelId: string; senderId: string; body: string; mentions: string[]; createdAt: Date; sender: { firstName: string; lastName: string } };
export const messageView = (m: MessageRow) => ({ id: m.id, channelId: m.channelId, senderId: m.senderId, senderName: fullName(m.sender), body: m.body, mentions: m.mentions, createdAt: m.createdAt });
export type MessageView = ReturnType<typeof messageView>;

/**
 * Messagerie interne : canaux « Tous », « Salle », « Cuisine » (membres selon le rôle) et messages directs.
 * Un membre ne lit et n'écrit que dans ses canaux ; `message.created` n'est diffusé qu'aux membres du canal.
 */
@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeService) {}

  /** Crée les canaux communs s'ils manquent et aligne les adhésions des personnes données sur leur rôle. */
  private async syncSystem(tx: Tx, tenantId: string, people: { id: string; role: string }[]) {
    const now = new Date();
    for (const d of SYSTEM) {
      await tx.$executeRaw`INSERT INTO "Channel" (id, "tenantId", name, "isDirect", key) VALUES (gen_random_uuid()::text, ${tenantId}, ${d.name}, false, ${d.key}) ON CONFLICT ("tenantId", key) DO NOTHING`;
      const ch = await tx.channel.findFirstOrThrow({ where: { tenantId, key: d.key }, select: { id: true } });
      const inn = people.filter((p) => d.roles.includes(p.role)), out = people.filter((p) => !d.roles.includes(p.role));
      await tx.channelMember.createMany({ data: inn.map((p) => ({ tenantId, channelId: ch.id, userId: p.id, lastReadAt: now })), skipDuplicates: true });
      if (out.length) await tx.channelMember.deleteMany({ where: { tenantId, channelId: ch.id, userId: { in: out.map((p) => p.id) } } });
    }
  }

  async channels(acc: Account) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.syncSystem(tx, tenantId, [acc]);
      const memberships = await tx.channelMember.findMany({
        where: { tenantId, userId: acc.id, channel: { OR: [{ isDirect: false }, { messages: { some: {} } }] } },
        include: { channel: { include: { members: true } } },
      });
      const userIds = [...new Set(memberships.flatMap((m) => m.channel.members.map((x) => x.userId)))];
      const users = await tx.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, role: true, isActive: true } });
      const byId = new Map(users.map((u) => [u.id, u]));
      const out = await Promise.all(memberships.map(async (m) => {
        const after = m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {};
        const [unread, unreadMentions, last] = await Promise.all([
          tx.message.count({ where: { tenantId, channelId: m.channelId, senderId: { not: acc.id }, ...after } }),
          tx.message.count({ where: { tenantId, channelId: m.channelId, senderId: { not: acc.id }, mentions: { has: acc.id }, ...after } }),
          tx.message.findFirst({ where: { tenantId, channelId: m.channelId }, orderBy: { createdAt: "desc" }, include: messageInclude }),
        ]);
        const members = m.channel.members.map((x) => byId.get(x.userId)).filter((u): u is NonNullable<typeof u> => !!u && u.isActive).map((u) => ({ id: u.id, name: fullName(u), role: u.role }));
        const sys = SYSTEM.find((s) => s.key === m.channel.key);
        const other = m.channel.isDirect ? members.find((u) => u.id !== acc.id) ?? null : null;
        return {
          id: m.channelId, kind: sys?.kind ?? "DIRECT", name: m.channel.isDirect ? other?.name ?? "Ancien membre" : m.channel.name ?? "Canal",
          isDirect: m.channel.isDirect, members, unread, unreadMentions,
          lastMessage: last && { body: last.body.slice(0, 120), senderName: fullName(last.sender), createdAt: last.createdAt },
        };
      }));
      const order = { ALL: 0, FLOOR: 1, KITCHEN: 2, DIRECT: 3 } as Record<string, number>;
      return out.sort((a, b) => order[a.kind] - order[b.kind] || (b.lastMessage?.createdAt.getTime() ?? 0) - (a.lastMessage?.createdAt.getTime() ?? 0));
    });
  }

  /** Total des non-lus (pastille de navigation). */
  async unread(acc: Account) {
    const list = await this.channels(acc);
    return { unread: list.reduce((n, c) => n + c.unread, 0), mentions: list.reduce((n, c) => n + c.unreadMentions, 0) };
  }

  /** Personnes avec qui démarrer une conversation. */
  async people(acc: Account) {
    const tenantId = acc.tenantId!;
    const users = await this.prisma.asTenant(tenantId, (tx) => tx.user.findMany({
      where: { tenantId, isActive: true, role: { not: "CUSTOMER" }, id: { not: acc.id } }, select: { id: true, firstName: true, lastName: true, role: true }, orderBy: { firstName: "asc" },
    }));
    return users.map((u) => ({ id: u.id, name: fullName(u), role: u.role }));
  }

  /** Ouvre (ou retrouve) la conversation privée avec une personne du même restaurant. */
  async direct(acc: Account, userId: string) {
    const tenantId = acc.tenantId!;
    if (userId === acc.id) throw new BadRequestException("Choisissez une autre personne que vous");
    const id = await this.prisma.asTenant(tenantId, async (tx) => {
      const other = await tx.user.findFirst({ where: { id: userId, tenantId, isActive: true, role: { not: "CUSTOMER" } }, select: { id: true } });
      if (!other) throw new NotFoundException("Membre introuvable");
      const key = `dm:${[acc.id, userId].sort().join(":")}`;
      await tx.$executeRaw`INSERT INTO "Channel" (id, "tenantId", name, "isDirect", key) VALUES (gen_random_uuid()::text, ${tenantId}, NULL, true, ${key}) ON CONFLICT ("tenantId", key) DO NOTHING`;
      const ch = await tx.channel.findFirstOrThrow({ where: { tenantId, key }, select: { id: true } });
      await tx.channelMember.createMany({ data: [acc.id, userId].map((u) => ({ tenantId, channelId: ch.id, userId: u, lastReadAt: new Date() })), skipDuplicates: true });
      return ch.id;
    });
    // La conversation vide n'apparaît pas encore dans `channels` : on la renvoie telle quelle.
    const list = await this.channels(acc);
    const found = list.find((c) => c.id === id);
    if (found) return found;
    const people = await this.people(acc);
    const other = people.find((p) => p.id === userId)!;
    return { id, kind: "DIRECT", name: other.name, isDirect: true, members: [other, { id: acc.id, name: fullName(acc), role: acc.role }], unread: 0, unreadMentions: 0, lastMessage: null };
  }

  private async member(tx: Tx, tenantId: string, channelId: string, userId: string) {
    const m = await tx.channelMember.findFirst({ where: { tenantId, channelId, userId }, include: { channel: { include: { members: { select: { userId: true } } } } } });
    if (!m) throw new NotFoundException("Canal introuvable");
    return m;
  }

  async messages(acc: Account, channelId: string, q: ListMessagesQuery) {
    const tenantId = acc.tenantId!;
    return this.prisma.asTenant(tenantId, async (tx) => {
      await this.member(tx, tenantId, channelId, acc.id);
      const rows = await tx.message.findMany({
        where: { tenantId, channelId, ...(q.before ? { createdAt: { lt: q.before } } : {}) },
        include: messageInclude, orderBy: { createdAt: "desc" }, take: q.limit + 1,
      });
      return { messages: rows.slice(0, q.limit).reverse().map(messageView), hasMore: rows.length > q.limit };
    });
  }

  async send(acc: Account, channelId: string, input: SendMessageInput) {
    const tenantId = acc.tenantId!;
    const { view, recipients } = await this.prisma.asTenant(tenantId, async (tx) => {
      let m = await this.member(tx, tenantId, channelId, acc.id);
      if (m.channel.key?.startsWith("sys:")) {
        // Canal commun : tout le personnel concerné y est inscrit, même s'il n'a pas encore ouvert la messagerie.
        await this.syncSystem(tx, tenantId, await tx.user.findMany({ where: { tenantId, isActive: true, role: { not: "CUSTOMER" } }, select: { id: true, role: true } }));
        m = await this.member(tx, tenantId, channelId, acc.id);
      }
      const ids = m.channel.members.map((x) => x.userId);
      const mentions = [...new Set(input.mentions)].filter((u) => ids.includes(u) && u !== acc.id);
      const msg = await tx.message.create({ data: { tenantId, channelId, senderId: acc.id, body: input.body, mentions }, include: messageInclude });
      await tx.channelMember.update({ where: { channelId_userId: { channelId, userId: acc.id } }, data: { lastReadAt: msg.createdAt } });
      return { view: messageView(msg), recipients: ids };
    });
    this.realtime.emitToUsers(tenantId, recipients, "message.created", view);
    return view;
  }

  async markRead(acc: Account, channelId: string) {
    const tenantId = acc.tenantId!;
    await this.prisma.asTenant(tenantId, async (tx) => {
      await this.member(tx, tenantId, channelId, acc.id);
      await tx.channelMember.update({ where: { channelId_userId: { channelId, userId: acc.id } }, data: { lastReadAt: new Date() } });
    });
    return { ok: true };
  }
}
