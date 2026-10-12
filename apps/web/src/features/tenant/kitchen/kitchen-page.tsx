import type { MenuCategory, Order, OrderItem } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban, Bell, BellOff, Check, ChefHat, ClipboardList, Expand, Flame, LogOut, Menu as MenuIcon, MessageSquareWarning, Minimize, NotebookPen,
  Undo2, UserRound, UtensilsCrossed, WifiOff,
} from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { BrandMark } from "@/components/brand-mark";
import { LiveIndicator } from "@/components/live-indicator";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { toastError } from "@/lib/errors";
import { courseLabel } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useRealtime, useOrderEvents } from "@/providers/realtime";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { useForcedTheme } from "@/providers/theme";
import { useApplyOrder, useNow, useTenant } from "../hooks";
import { useMenu } from "../pos/pos-page";
import {
  boardCounts, elapsedTone, formatElapsed, isOrderReady, nextKitchenStatus, previousKitchenStatus, referencePrepMinutes, type BoardFilter,
} from "./kitchen-logic";

const SOUND_KEY = "restaurant.kds.sound";
const readSound = () => { try { return localStorage.getItem(SOUND_KEY) === "on"; } catch { return false; } };

/** Bip court à deux tons (Web Audio : pas de fichier à charger). */
function useChime(enabled: boolean) {
  const ctx = React.useRef<AudioContext | null>(null);
  const prime = React.useCallback(() => {
    try { ctx.current ??= new AudioContext(); void ctx.current.resume(); } catch { /* audio indisponible */ }
  }, []);
  const play = React.useCallback(() => {
    if (!enabled || !ctx.current) return;
    const c = ctx.current;
    [0, 0.16].forEach((at, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = i ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, c.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + 0.14);
      o.connect(g).connect(c.destination);
      o.start(c.currentTime + at); o.stop(c.currentTime + at + 0.15);
    });
  }, [enabled]);
  return { prime, play };
}

/**
 * Écran cuisine : toujours sombre, lisible à 2 m, cibles ≥ 56 px, aucune animation décorative.
 * Les commandes arrivent en temps réel (surlignage + son optionnel) ; le plus ancien en premier.
 */
export function KitchenPage() {
  useForcedTheme("dark");
  const t = useTenant();
  const qc = useQueryClient();
  const { status } = useRealtime();
  const connected = status === "connected";
  const board = useQuery({
    queryKey: tenantKeys.kitchen(t.root), queryFn: t.api.kitchen,
    // Filet de sécurité si la socket est coupée : rechargement périodique.
    refetchInterval: connected ? false : 20_000,
  });
  const now = useNow(1000);
  const [filter, setFilter] = React.useState<BoardFilter>("all");
  const [sound, setSound] = React.useState(readSound);
  const [fresh, setFresh] = React.useState<Record<string, number>>({});
  const [soldOut, setSoldOut] = React.useState(false);
  const chime = useChime(sound);

  // Nouvelle commande, ou articles ajoutés à une commande : surlignage 8 s + son si activé.
  useOrderEvents((event, o) => {
    const added = event === "order.updated" && o.items.some((i) => i.status === "PENDING" && Date.now() - new Date(i.createdAt).getTime() < 15_000);
    if (event === "order.created" || added) {
      setFresh((f) => ({ ...f, [o.id]: Date.now() }));
      chime.play();
    }
  });
  React.useEffect(() => {
    const id = setInterval(() => setFresh((f) => {
      const keep = Object.entries(f).filter(([, at]) => Date.now() - at < 8000);
      return keep.length === Object.keys(f).length ? f : Object.fromEntries(keep);
    }), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleSound = () => {
    const next = !sound;
    if (next) chime.prime();
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? "on" : "off"); } catch { /* ignore */ }
  };

  const orders = board.data ?? [];
  const counts = boardCounts(orders);
  const shown = orders.filter((o) => filter === "all" ? true : filter === "ready" ? isOrderReady(o) : !isOrderReady(o));

  return (
    <div className="dark flex h-dvh flex-col bg-background text-foreground [color-scheme:dark]">
      <KdsHeader counts={counts} now={now} filter={filter} setFilter={setFilter} sound={sound} toggleSound={toggleSound} openSoldOut={() => setSoldOut(true)} />
      {!connected && status !== "idle" && status !== "connecting" && (
        <div role="status" className="flex items-center gap-3 border-b border-[color-mix(in_oklab,var(--tone-amber-dot)_40%,var(--border))] bg-[var(--tone-amber-bg)] px-4 py-3 text-base font-medium text-[var(--tone-amber-fg)]">
          <WifiOff className="size-5 shrink-0" /> Connexion perdue : reconnexion en cours. L'écran se recharge toutes les 20 secondes en attendant.
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {board.isError ? <ErrorState error={board.error} onRetry={() => board.refetch()} /> : board.isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] items-start gap-3 sm:gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-xl" />)}</div>
        ) : shown.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <span className="flex size-20 items-center justify-center rounded-2xl border border-border bg-card"><ChefHat className="size-9 text-muted-foreground" /></span>
            <p className="text-2xl font-semibold">{filter === "ready" ? "Aucune commande prête" : "Aucune commande en attente"}</p>
            <p className="max-w-md text-lg text-muted-foreground">Les nouvelles commandes s'affichent ici dès qu'elles sont envoyées par la salle.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] items-start gap-3 sm:gap-4">
            {shown.map((o) => <li key={o.id}><TicketCard order={o} now={now} fresh={!!fresh[o.id]} onUpdated={() => void qc.invalidateQueries({ queryKey: tenantKeys.kitchen(t.root) })} /></li>)}
          </ul>
        )}
      </main>
      <SoldOutPanel open={soldOut} onOpenChange={setSoldOut} />
    </div>
  );
}

function KdsHeader({ counts, now, filter, setFilter, sound, toggleSound, openSoldOut }: {
  counts: ReturnType<typeof boardCounts>; now: number; filter: BoardFilter; setFilter: (f: BoardFilter) => void;
  sound: boolean; toggleSound: () => void; openSoldOut: () => void;
}) {
  const t = useTenant();
  const to = useSpacePath();
  const navigate = useNavigate();
  const session = useSession();
  const [full, setFull] = React.useState(() => typeof document !== "undefined" && !!document.fullscreenElement);
  React.useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => toast.error("Plein écran indisponible sur cet appareil"));
  };
  const big = "h-14 min-w-14 px-4 text-base [&_svg]:!size-5";
  const filters: { v: BoardFilter; label: string; n?: number; dot: string }[] = [
    { v: "all", label: "Tout", dot: "" },
    { v: "todo", label: "À préparer", n: counts.pending + counts.inProgress, dot: "bg-[var(--tone-amber-dot)]" },
    { v: "ready", label: "Prêts", n: counts.ready, dot: "bg-[var(--tone-green-dot)]" },
  ];
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-subtle px-3 py-2 sm:gap-3 sm:px-4 lg:flex-nowrap">
      <div className="flex min-w-0 items-center gap-3 pr-1">
        <BrandMark size={32} className="hidden xl:flex" />
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-semibold">Cuisine</span>
          <span className="font-mono text-sm text-muted-foreground tabular-nums">{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(now)}</span>
        </div>
      </div>
      <div role="radiogroup" aria-label="Commandes affichées" className="flex rounded-xl border border-border bg-background p-1">
        {filters.map((f) => (
          <button key={f.v} type="button" role="radio" aria-checked={filter === f.v} onClick={() => setFilter(f.v)}
            className={cn("flex h-12 items-center gap-2 rounded-lg px-4 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f.v ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {f.dot && <span aria-hidden className={cn("size-2.5 rounded-full", f.dot)} />}{f.label}
            {f.n !== undefined && <span className="font-mono tabular-nums">{f.n}</span>}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <LiveIndicator size="lg" className="hidden md:inline-flex" />
        <Button variant="secondary" className={big} onClick={openSoldOut}><Ban /> Épuisé</Button>
        <Button variant={sound ? "secondary" : "ghost"} className={big} onClick={toggleSound} aria-pressed={sound} aria-label={sound ? "Couper le son des nouvelles commandes" : "Activer le son des nouvelles commandes"}>
          {sound ? <Bell /> : <BellOff />}<span className="hidden xl:inline">{sound ? "Son activé" : "Son coupé"}</span>
        </Button>
        <Button variant="ghost" className={cn(big, "hidden sm:inline-flex")} onClick={toggleFull} aria-label={full ? "Quitter le plein écran" : "Plein écran"}>{full ? <Minimize /> : <Expand />}</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" className={big} aria-label="Menu"><MenuIcon /></Button></DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-[240px] [&_[role=menuitem]]:min-h-12 [&_[role=menuitem]]:text-base">
            <DropdownMenuItem onSelect={() => navigate(to("/commandes"))}><ClipboardList /> Commandes</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(to("/menu"))}><UtensilsCrossed /> {t.isManager ? "Menu" : "Disponibilités"}</DropdownMenuItem>
            {t.isManager && <DropdownMenuItem onSelect={() => navigate(to("/"))}><ChefHat /> Tableau de bord</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => navigate(to("/compte"))}><UserRound /> Mon compte</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void session.logout()}><LogOut /> Se déconnecter</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

const TONE_BORDER = { normal: "border-border", amber: "border-[var(--tone-amber-dot)]", red: "border-[var(--tone-red-dot)]" } as const;
const TONE_TEXT = { normal: "text-foreground", amber: "text-[var(--tone-amber-fg)]", red: "text-[var(--tone-red-fg)]" } as const;

/** Ticket d'une commande : numéro, table, chrono, articles à faire avancer d'un tap. */
function TicketCard({ order, now, fresh, onUpdated }: { order: Order; now: number; fresh: boolean; onUpdated: () => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const apply = useApplyOrder();
  const [busy, setBusy] = React.useState<Set<string>>(new Set());
  const ready = isOrderReady(order);
  const ref = referencePrepMinutes(order.items);
  const elapsed = now - new Date(order.createdAt).getTime();
  const tone = ready ? "normal" : elapsedTone(elapsed, ref);
  const courses = [...new Set(order.items.map((i) => i.course))].sort((a, b) => a - b);

  // Mise à jour optimiste de l'écran cuisine, corrigée par la réponse (ou annulée en cas d'erreur).
  const patchLocal = (fn: (i: OrderItem) => OrderItem) =>
    qc.setQueryData<Order[]>(tenantKeys.kitchen(t.root), (rows) => rows?.map((o) => (o.id === order.id ? { ...o, items: o.items.map(fn) } : o)));

  const setItem = async (item: OrderItem, to: "PENDING" | "IN_PROGRESS" | "READY") => {
    if (busy.has(item.id)) return;
    setBusy((b) => new Set(b).add(item.id));
    patchLocal((i) => (i.id === item.id ? { ...i, status: to } : i));
    try { apply(await t.api.orders.setItemStatus(order.id, item.id, to)); } catch (e) { toastError(e); onUpdated(); } finally {
      setBusy((b) => { const n = new Set(b); n.delete(item.id); return n; });
    }
  };
  const advance = useMutation({
    mutationFn: (to: "IN_PROGRESS" | "READY") => t.api.orders.advance(order.id, to),
    onMutate: (to) => patchLocal((i) => (to === "READY" || i.status === "PENDING" ? { ...i, status: to } : i)),
    onSuccess: (o) => apply(o),
    onError: (e) => { toastError(e); onUpdated(); },
  });
  const hasPending = order.items.some((i) => i.status === "PENDING");

  return (
    <article
      aria-label={`Commande ${order.number}`}
      className={cn("flex flex-col overflow-hidden rounded-xl border-2 bg-card",
        ready ? "border-[var(--tone-green-dot)]" : TONE_BORDER[tone],
        fresh && "outline outline-4 outline-offset-2 outline-[var(--brand-ink)]")}
    >
      <header className={cn("flex items-start justify-between gap-3 border-b border-border px-4 py-3", ready && "bg-[var(--tone-green-bg)]")}>
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="font-mono text-4xl font-bold leading-none tracking-tight tabular-nums">{order.number}</span>
            {fresh && <span className="rounded-md bg-brand px-2 py-1 text-sm font-semibold text-brand-foreground">Nouveau</span>}
          </div>
          <span className="mt-1.5 truncate text-xl font-semibold">{order.table ? `Table ${order.table.label}` : `À emporter${order.customerName ? ` · ${order.customerName}` : ""}`}</span>
          {order.waiter && <span className="text-sm text-muted-foreground">{order.waiter.firstName}</span>}
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className={cn("font-mono text-3xl font-semibold leading-none tabular-nums", ready ? "text-[var(--tone-green-fg)]" : TONE_TEXT[tone])}>
            {formatElapsed(elapsed)}
          </span>
          <span className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            {tone === "red" && !ready && <Flame className="size-4 text-[var(--tone-red-fg)]" aria-label="En retard" />}
            réf. {ref} min
          </span>
        </div>
      </header>
      {order.notes && (
        <p className="flex items-start gap-2 border-b border-border bg-[var(--tone-amber-bg)] px-4 py-2.5 text-base font-semibold text-[var(--tone-amber-fg)]">
          <NotebookPen className="mt-0.5 size-5 shrink-0" />{order.notes}
        </p>
      )}
      <div className="flex flex-col">
        {courses.map((c) => (
          <section key={c}>
            {courses.length > 1 && <h3 className="border-b border-border bg-subtle px-4 py-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{courseLabel(c)}</h3>}
            <ul className="divide-y divide-border">
              {order.items.filter((i) => i.course === c).map((i) => (
                <KitchenItem key={i.id} item={i} busy={busy.has(i.id)} onTap={() => { const n = nextKitchenStatus(i.status); if (n) void setItem(i, n); }}
                  onUndo={() => { const p = previousKitchenStatus(i.status); if (p) void setItem(i, p); }} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <footer className="mt-auto flex gap-2 border-t border-border p-3">
        {ready ? (
          <p className="flex h-14 flex-1 items-center justify-center gap-2 rounded-lg text-lg font-semibold text-[var(--tone-green-fg)]"><Check className="size-6" /> Prêt · en attente du service</p>
        ) : (
          <>
            {hasPending && <Button variant="secondary" className="h-14 flex-1 text-base" loading={advance.isPending && advance.variables === "IN_PROGRESS"} onClick={() => advance.mutate("IN_PROGRESS")}>Lancer</Button>}
            <Button variant="primary" className="h-14 flex-1 text-base" loading={advance.isPending && advance.variables === "READY"} onClick={() => advance.mutate("READY")}><Check className="!size-5" /> Tout est prêt</Button>
          </>
        )}
      </footer>
    </article>
  );
}

const ITEM_PILL = {
  PENDING: { label: "À faire", cls: "bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]" },
  IN_PROGRESS: { label: "En cours", cls: "bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]" },
  READY: { label: "Prêt", cls: "bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]" },
} as Record<string, { label: string; cls: string }>;

function KitchenItem({ item, busy, onTap, onUndo }: { item: OrderItem; busy: boolean; onTap: () => void; onUndo: () => void }) {
  const pill = ITEM_PILL[item.status] ?? ITEM_PILL.PENDING!;
  const done = item.status === "READY";
  const canUndo = item.status === "IN_PROGRESS" || item.status === "READY";
  const next = nextKitchenStatus(item.status);
  return (
    <li className={cn("flex items-stretch", item.status === "IN_PROGRESS" && "bg-[color-mix(in_oklab,var(--tone-blue-bg)_55%,transparent)]")}>
      <button
        type="button"
        onClick={onTap}
        disabled={!next || busy}
        aria-label={`${item.quantity} ${item.name} : ${pill.label}${next ? `. Toucher pour passer à ${next === "IN_PROGRESS" ? "en cours" : "prêt"}` : ""}`}
        className={cn("flex min-h-16 min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          next && "hover:bg-hover active:bg-muted", busy && "opacity-60")}
      >
        <span className={cn("w-9 shrink-0 font-mono text-2xl font-bold leading-7 tabular-nums", done && "text-muted-foreground")}>{item.quantity}×</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-start justify-between gap-2">
            <span className={cn("min-w-0 text-lg font-semibold leading-7 xl:text-xl", done && "text-muted-foreground")}>{item.name}</span>
            <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold", pill.cls)}>{done && <Check className="size-3.5" />}{pill.label}</span>
          </span>
          {item.options.length > 0 && <span className="text-base font-medium text-[var(--tone-blue-fg)]">{item.options.map((o) => o.name).join(" · ")}</span>}
          {item.instructions && (
            <span className="inline-flex w-fit max-w-full items-start gap-1.5 rounded-md bg-[var(--tone-amber-bg)] px-2 py-1 text-base font-semibold text-[var(--tone-amber-fg)]">
              <MessageSquareWarning className="mt-1 size-4 shrink-0" /><span>{item.instructions}</span>
            </span>
          )}
        </span>
      </button>
      {canUndo && (
        <button type="button" onClick={onUndo} disabled={busy} aria-label={`Revenir en arrière pour ${item.name}`}
          className="flex w-14 shrink-0 items-center justify-center border-l border-border text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Undo2 className="size-5" />
        </button>
      )}
    </li>
  );
}

/** Panneau « Épuisé » : la cuisine retire ou remet un plat en un geste. */
function SoldOutPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const menu = useMenu();
  const toggle = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) => t.api.menu.setAvailability(id, value),
    onMutate: ({ id, value }) => qc.setQueryData<MenuCategory[]>(tenantKeys.menu(t.root), (cats) => cats?.map((c) => ({ ...c, items: c.items.map((i) => (i.id === id ? { ...i, isAvailable: value } : i)) }))),
    onSuccess: (item) => toast.success(item.isAvailable ? `« ${item.name} » de nouveau disponible` : `« ${item.name} » marqué épuisé`),
    onError: (e) => { toastError(e); void qc.invalidateQueries({ queryKey: tenantKeys.menu(t.root) }); },
  });
  const cats = (menu.data ?? []).filter((c) => c.items.length);
  const out = cats.flatMap((c) => c.items).filter((i) => !i.isAvailable).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Plats épuisés" description={`${out} plat${out > 1 ? "s" : ""} retiré${out > 1 ? "s" : ""} de la prise de commande. Touchez pour changer.`}>
      {menu.isLoading ? <Skeleton className="h-60" /> : (
        <div className="flex flex-col gap-5">
          {cats.map((c) => (
            <section key={c.id}>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{c.name}</h3>
              <ul className="flex flex-col gap-2">
                {c.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    <span className={cn("min-w-0 flex-1 text-lg font-medium", !i.isAvailable && "text-muted-foreground line-through")}>{i.name}</span>
                    <button type="button" aria-pressed={!i.isAvailable} onClick={() => toggle.mutate({ id: i.id, value: !i.isAvailable })}
                      className={cn("h-14 w-40 shrink-0 rounded-lg border-2 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        i.isAvailable ? "border-border text-foreground hover:bg-hover" : "border-[var(--tone-red-dot)] bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]")}>
                      {i.isAvailable ? "Disponible" : "Épuisé"}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
