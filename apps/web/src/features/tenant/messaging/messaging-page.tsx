import type { ChatChannel, ChatMember, ChatMessage } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChefHat, HandPlatter, MessageSquarePlus, Send, Users } from "lucide-react";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { TENANT_ROLE_LABEL } from "@/lib/labels";
import { appendMessage, setActiveChannel, type MessagePage } from "@/lib/realtime/messaging-cache";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useSession } from "@/providers/session";
import { useTenant } from "../hooks";
import { useChannels } from "./messaging-hooks";

const ICON: Record<ChatChannel["kind"], React.ReactNode> = { ALL: <Users />, FLOOR: <HandPlatter />, KITCHEN: <ChefHat />, DIRECT: null };
const hhmm = (iso: string) => new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const dayHeading = (iso: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));

/** Messagerie interne : canaux communs (Tous, Salle, Cuisine) et messages directs, en direct, avec non-lus et mentions. */
export function MessagingPage() {
  const channels = useChannels();
  const [selected, setSelected] = useUrlParam("canal", "");
  const [newDm, setNewDm] = React.useState(false);
  const list = channels.data ?? [];
  const current = list.find((c) => c.id === selected) ?? null;
  // Sur grand écran, on ouvre d'office le premier canal ; sur mobile on montre d'abord la liste.
  const [wide, setWide] = React.useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches);
  React.useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  React.useEffect(() => { if (wide && !selected && list[0]) setSelected(list[0].id); }, [wide, selected, list[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader className="pb-4" title="Messagerie" description="Échangez avec l'équipe en salle, en cuisine ou en direct." actions={<Button variant="secondary" onClick={() => setNewDm(true)}><MessageSquarePlus /> Nouveau message</Button>} />
      {channels.isError ? <ErrorState error={channels.error} onRetry={() => void channels.refetch()} /> : (
        <div className="grid h-[calc(100dvh-15rem)] min-h-[420px] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-card shadow-sm md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className={cn("flex min-h-0 flex-col border-border md:border-r", current && !wide && "hidden")} aria-label="Conversations">
            {channels.isLoading ? <div className="flex flex-col gap-2 p-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div> : (
              <ul className="flex-1 overflow-y-auto p-2">
                {list.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setSelected(c.id)} aria-current={c.id === selected ? "true" : undefined}
                      className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", c.id === selected && "bg-brand-tint")}>
                      <ChannelAvatar c={c} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex items-center justify-between gap-2"><span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.name}</span>{c.lastMessage && <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(c.lastMessage.createdAt)}</span>}</span>
                        <span className="truncate text-[13px] text-muted-foreground">{c.lastMessage ? `${c.lastMessage.senderName} : ${c.lastMessage.body}` : "Aucun message"}</span>
                      </span>
                      {c.unread > 0 && <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums", c.unreadMentions ? "bg-danger text-danger-foreground" : "bg-brand text-brand-foreground")} aria-label={`${c.unread} non lu${c.unread > 1 ? "s" : ""}${c.unreadMentions ? ", vous êtes mentionné" : ""}`}>{c.unreadMentions ? "@" : ""}{c.unread}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
          <section className={cn("min-h-0 min-w-0", !current && !wide && "hidden")} aria-label="Conversation">
            {current ? <Conversation key={current.id} channel={current} onBack={() => setSelected(null)} /> : <EmptyState title="Choisissez une conversation" description="Vos canaux apparaissent à gauche." />}
          </section>
        </div>
      )}
      <NewDirectDialog open={newDm} onClose={() => setNewDm(false)} onOpened={(c) => { setNewDm(false); setSelected(c.id); }} />
    </>
  );
}

function ChannelAvatar({ c }: { c: ChatChannel }) {
  if (c.isDirect) { const [first, ...rest] = c.name.split(" "); return <Avatar firstName={first} lastName={rest.join(" ")} size={36} />; }
  return <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground [&_svg]:size-4">{ICON[c.kind]}</span>;
}

/** Texte d'un message avec les mentions « @Prénom Nom » mises en évidence. */
function MessageText({ body, members, mine }: { body: string; members: ChatMember[]; mine: boolean }) {
  const names = members.map((m) => m.name).sort((a, b) => b.length - a.length);
  if (!names.length) return <>{body}</>;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = body.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return <>{parts.map((p, i) => (p.startsWith("@") && names.includes(p.slice(1)) ? <mark key={i} className={cn("rounded px-1 font-medium", mine ? "bg-background/25 text-inherit" : "bg-brand-tint text-brand-ink")}>{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}

function Conversation({ channel, onBack }: { channel: ChatChannel; onBack: () => void }) {
  const t = useTenant();
  const { user } = useSession();
  const qc = useQueryClient();
  const me = user!.id;
  const key = tenantKeys.chatMessages(t.root, channel.id);
  const q = useQuery({ queryKey: key, queryFn: () => t.api.messaging.messages(channel.id), staleTime: 0 });
  const bottom = React.useRef<HTMLDivElement>(null);
  const [older, setOlder] = React.useState(false);

  // Le canal ouvert est lu d'office : au montage, puis à chaque nouveau message reçu pendant qu'on le regarde.
  const markRead = React.useCallback(() => {
    qc.setQueryData<ChatChannel[]>(tenantKeys.chatChannels(t.root), (l) => l?.map((c) => (c.id === channel.id ? { ...c, unread: 0, unreadMentions: 0 } : c)));
    void t.api.messaging.read(channel.id).catch(() => undefined);
  }, [qc, t.root, t.api, channel.id]);
  React.useEffect(() => { setActiveChannel(channel.id); markRead(); return () => setActiveChannel(null); }, [channel.id, markRead]);
  const count = q.data?.messages.length ?? 0;
  const lastId = q.data?.messages[count - 1]?.id;
  React.useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); if (lastId) markRead(); }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadOlder = async () => {
    const first = q.data?.messages[0];
    if (!first) return;
    setOlder(true);
    try {
      const page = await t.api.messaging.messages(channel.id, { before: first.createdAt });
      qc.setQueryData<MessagePage>(key, (cur) => cur && { hasMore: page.hasMore, messages: [...page.messages, ...cur.messages] });
    } catch (e) { toastError(e); } finally { setOlder(false); }
  };

  const messages = q.data?.messages ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Retour aux conversations" onClick={onBack}><ArrowLeft /></Button>
        <ChannelAvatar c={channel} />
        <div className="flex min-w-0 flex-col leading-tight"><h2 className="truncate text-sm font-semibold">{channel.name}</h2><p className="truncate text-[12.5px] text-muted-foreground">{channel.isDirect ? "Conversation privée" : `${channel.members.length} membre${channel.members.length > 1 ? "s" : ""}`}</p></div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4" role="log" aria-live="polite" aria-label={`Messages de ${channel.name}`}>
        {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} compact /> : q.isLoading ? <div className="flex flex-col gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className={cn("h-10 w-2/3", i % 2 && "self-end")} />)}</div> : (
          <>
            {q.data?.hasMore && <div className="mb-3 text-center"><Button variant="ghost" size="sm" loading={older} onClick={() => void loadOlder()}>Messages précédents</Button></div>}
            {!messages.length && <p className="py-10 text-center text-sm text-muted-foreground">Aucun message. Lancez la conversation.</p>}
            <ol className="flex flex-col gap-1">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                const grouped = !newDay && prev?.senderId === m.senderId && +new Date(m.createdAt) - +new Date(prev.createdAt) < 5 * 60_000;
                return (
                  <React.Fragment key={m.id}>
                    {newDay && <li className="my-3 text-center text-[12px] font-medium text-muted-foreground first-letter:uppercase" aria-hidden>{dayHeading(m.createdAt)}</li>}
                    <Bubble m={m} mine={m.senderId === me} grouped={grouped} members={channel.members} me={me} />
                  </React.Fragment>
                );
              })}
            </ol>
            <div ref={bottom} />
          </>
        )}
      </div>
      <Composer channel={channel} onSent={(m) => qc.setQueryData<MessagePage>(key, (cur) => (cur ? appendMessage(cur, m) : { messages: [m], hasMore: false }))} />
    </div>
  );
}

function Bubble({ m, mine, grouped, members, me }: { m: ChatMessage; mine: boolean; grouped: boolean; members: ChatMember[]; me: string }) {
  const mentioned = m.mentions.includes(me);
  return (
    <li className={cn("flex flex-col", mine ? "items-end" : "items-start", grouped ? "mt-0" : "mt-2")}>
      {!grouped && !mine && <span className="mb-0.5 px-1 text-[12px] font-medium text-muted-foreground">{m.senderName}</span>}
      <div className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14.5px] leading-snug sm:max-w-[70%]", mine ? "rounded-br-md bg-foreground text-background" : "rounded-bl-md bg-muted text-foreground", mentioned && !mine && "ring-2 ring-brand")}>
        <MessageText body={m.body} members={members} mine={mine} />
        <span className={cn("ml-2 inline-block translate-y-0.5 font-mono text-[10.5px] tabular-nums", mine ? "text-background/60" : "text-muted-foreground")}>{hhmm(m.createdAt)}</span>
      </div>
    </li>
  );
}

function Composer({ channel, onSent }: { channel: ChatChannel; onSent: (m: ChatMessage) => void }) {
  const t = useTenant();
  const { user } = useSession();
  const [text, setText] = React.useState("");
  const [mentions, setMentions] = React.useState<ChatMember[]>([]);
  const [caret, setCaret] = React.useState(0);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const send = useMutation({
    mutationFn: () => {
      const body = text.trim();
      const ids = mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
      return t.api.messaging.send(channel.id, { body, mentions: ids });
    },
    onSuccess: (m) => { onSent(m); setText(""); setMentions([]); },
    onError: (e) => toastError(e),
  });
  // Suggestions : « @ » suivi de lettres juste avant le curseur.
  const trigger = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  const query = trigger?.[2]?.toLowerCase() ?? "";
  const suggestions = trigger ? channel.members.filter((m) => m.id !== user?.id && m.name.toLowerCase().replace(/\s/g, "").includes(query.replace(/\s/g, ""))).slice(0, 5) : [];
  const pick = (m: ChatMember) => {
    const start = caret - (trigger?.[2]?.length ?? 0) - 1;
    const next = `${text.slice(0, start)}@${m.name} ${text.slice(caret)}`;
    setText(next);
    setMentions((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
    requestAnimationFrame(() => { const pos = start + m.name.length + 2; ref.current?.focus(); ref.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };
  const submit = () => { if (text.trim() && !send.isPending) send.mutate(); };
  return (
    <form className="relative border-t border-border p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Mentionner" className="absolute inset-x-3 bottom-full mb-1 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
          {suggestions.map((m) => (
            <li key={m.id} role="option" aria-selected="false">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
                <span className="font-medium">{m.name}</span><span className="text-[12.5px] text-muted-foreground">{TENANT_ROLE_LABEL[m.role]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref} value={text} rows={1} maxLength={2000} aria-label={`Message dans ${channel.name}`} placeholder="Écrire un message…"
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }} onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !suggestions.length) { e.preventDefault(); submit(); } }}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2.5 text-[15px] shadow-xs placeholder:text-faint hover:border-border-strong focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:min-h-9 sm:py-2 sm:text-sm"
        />
        <Button type="submit" variant="primary" size="icon" aria-label="Envoyer" loading={send.isPending} disabled={!text.trim()}><Send /></Button>
      </div>
    </form>
  );
}

function NewDirectDialog({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (c: ChatChannel) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const people = useQuery({ queryKey: tenantKeys.chatPeople(t.root), queryFn: () => t.api.messaging.people(), enabled: open, staleTime: 60_000 });
  const open1 = useMutation({
    mutationFn: (userId: string) => t.api.messaging.direct(userId),
    onSuccess: (c) => {
      qc.setQueryData<ChatChannel[]>(tenantKeys.chatChannels(t.root), (l) => (l && !l.some((x) => x.id === c.id) ? [...l, c] : l));
      onOpened(c);
    },
    onError: (e) => toastError(e),
  });
  const shown = (people.data ?? []).filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setSearch(""); } }} size="sm" title="Nouveau message" description="Choisissez une personne de l'équipe : la conversation reste privée.">
      <div className="flex flex-col gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un nom" aria-label="Rechercher un nom" autoFocus />
        {people.isError ? <ErrorState error={people.error} onRetry={() => void people.refetch()} compact /> : (
          <ul className="max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {people.isLoading && <li className="p-3"><Skeleton className="h-8" /></li>}
            {shown.map((p) => {
              const [first, ...rest] = p.name.split(" ");
              return (
                <li key={p.id}>
                  <button type="button" disabled={open1.isPending} onClick={() => open1.mutate(p.id)} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
                    <Avatar firstName={first} lastName={rest.join(" ")} size={32} /><span className="flex flex-col leading-tight"><span className="text-sm font-medium">{p.name}</span><span className="text-[12.5px] text-muted-foreground">{TENANT_ROLE_LABEL[p.role]}</span></span>
                  </button>
                </li>
              );
            })}
            {!people.isLoading && !shown.length && <li className="p-4 text-center text-sm text-muted-foreground">Personne ne correspond.</li>}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
