import type { ChatChannel, ChatMessage } from "@restaurant/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { tenantKeys } from "../../tenant-keys";
import { appendMessage, applyMessageEvent, applyMessageToChannels, setActiveChannel, totalUnread } from "../messaging-cache";

const ch = (id: string, over: Partial<ChatChannel> = {}): ChatChannel => ({ id, kind: "FLOOR", name: "Salle", isDirect: false, members: [], unread: 0, unreadMentions: 0, lastMessage: null, ...over });
const msg = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({ id, channelId: "c1", senderId: "u2", senderName: "Ama", body: "Salut", mentions: [], createdAt: `2026-11-16T10:0${id}:00.000Z`, ...over });

describe("messagerie temps réel : caches", () => {
  it("ajoute un message sans doublon, en ordre chronologique", () => {
    const page = { messages: [msg("2")], hasMore: false };
    expect(appendMessage(appendMessage(page, msg("1")), msg("1")).messages.map((m) => m.id)).toEqual(["1", "2"]);
  });
  it("compte non lus et mentions, jamais pour soi ni pour le canal ouvert", () => {
    const list = [ch("c1"), ch("c2")];
    const r1 = applyMessageToChannels(list, msg("1", { mentions: ["me"] }), { me: "me", active: null })!;
    expect(r1[0]).toMatchObject({ unread: 1, unreadMentions: 1, lastMessage: { senderName: "Ama" } });
    expect(applyMessageToChannels(list, msg("2", { senderId: "me" }), { me: "me", active: null })![0].unread).toBe(0);
    expect(applyMessageToChannels(list, msg("3"), { me: "me", active: "c1" })![0].unread).toBe(0);
    expect(totalUnread(r1)).toBe(1);
  });
  it("canal inconnu : à recharger", () => {
    expect(applyMessageToChannels([ch("c9")], msg("1"), { me: "me", active: null })).toBeNull();
  });
  it("met à jour les caches et dit s'il faut notifier (mention ou message direct)", () => {
    const qc = new QueryClient();
    const root = ["tenant", "demo"] as const;
    qc.setQueryData(tenantKeys.chatChannels(root), [ch("c1"), ch("d1", { isDirect: true, kind: "DIRECT", name: "Ama" })]);
    qc.setQueryData(tenantKeys.chatMessages(root, "c1"), { messages: [], hasMore: false });
    setActiveChannel(null);
    expect(applyMessageEvent(qc, root, msg("1"), "me").notify).toBe(false); // canal commun sans mention : discret
    expect(applyMessageEvent(qc, root, msg("2", { mentions: ["me"] }), "me").notify).toBe(true);
    expect(applyMessageEvent(qc, root, msg("3", { channelId: "d1" }), "me").notify).toBe(true);
    setActiveChannel("d1");
    expect(applyMessageEvent(qc, root, msg("4", { channelId: "d1" }), "me").notify).toBe(false);
    expect(qc.getQueryData<{ messages: unknown[] }>(tenantKeys.chatMessages(root, "c1"))!.messages).toHaveLength(2);
    expect(totalUnread(qc.getQueryData(tenantKeys.chatChannels(root)))).toBe(3);
    setActiveChannel(null);
  });
});
