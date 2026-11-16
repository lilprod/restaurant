import type { ChatChannel, ChatMessage } from "@restaurant/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { tenantKeys } from "../tenant-keys";

type Root = readonly unknown[];
export type MessagePage = { messages: ChatMessage[]; hasMore: boolean };

/** Conversation actuellement affichée : ses nouveaux messages sont lus d'office. */
let activeChannelId: string | null = null;
export const setActiveChannel = (id: string | null) => { activeChannelId = id; };
export const getActiveChannel = () => activeChannelId;

/** Ajoute un message à une page d'historique (sans doublon, ordre chronologique). */
export function appendMessage(page: MessagePage, m: ChatMessage): MessagePage {
  if (page.messages.some((x) => x.id === m.id)) return page;
  return { ...page, messages: [...page.messages, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
}

/** Met à jour l'aperçu et les compteurs d'un canal après un message reçu (les siens ne comptent pas comme non lus). */
export function applyMessageToChannels(list: ChatChannel[], m: ChatMessage, opts: { me: string; active: string | null }): ChatChannel[] | null {
  const ch = list.find((c) => c.id === m.channelId);
  if (!ch) return null; // canal inconnu (nouveau message direct) : l'appelant recharge la liste
  const mine = m.senderId === opts.me;
  const read = mine || opts.active === m.channelId;
  const next: ChatChannel = {
    ...ch,
    unread: read ? ch.unread : ch.unread + 1,
    unreadMentions: !read && m.mentions.includes(opts.me) ? ch.unreadMentions + 1 : ch.unreadMentions,
    lastMessage: { body: m.body.slice(0, 120), senderName: m.senderName, createdAt: m.createdAt },
  };
  return list.map((c) => (c.id === ch.id ? next : c));
}

/** Total de non-lus (pastille de navigation). */
export const totalUnread = (list: ChatChannel[] | undefined) => (list ?? []).reduce((n, c) => n + c.unread, 0);

/** Reporte un message temps réel dans les caches ; retourne vrai s'il faut notifier la personne. */
export function applyMessageEvent(qc: QueryClient, root: Root, m: ChatMessage, me: string): { notify: boolean } {
  const page = qc.getQueryData<MessagePage>(tenantKeys.chatMessages(root, m.channelId));
  if (page) qc.setQueryData(tenantKeys.chatMessages(root, m.channelId), appendMessage(page, m));
  const active = getActiveChannel();
  const list = qc.getQueryData<ChatChannel[]>(tenantKeys.chatChannels(root));
  const next = list && applyMessageToChannels(list, m, { me, active });
  if (next) qc.setQueryData(tenantKeys.chatChannels(root), next);
  else void qc.invalidateQueries({ queryKey: tenantKeys.chatChannels(root) });
  const ch = list?.find((c) => c.id === m.channelId);
  const relevant = !!ch?.isDirect || !ch || m.mentions.includes(me);
  return { notify: m.senderId !== me && active !== m.channelId && relevant };
}
