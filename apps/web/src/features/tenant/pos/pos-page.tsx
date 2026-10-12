import { ApiError, type DiningTable, type MenuItem } from "@restaurant/api-client";
import { tableStatusTone } from "@restaurant/ui-tokens";
import { createOrderSchema, addItemsSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LayoutGrid, Layers, Search, ShoppingBag, ShoppingCart, Star, UtensilsCrossed, X } from "lucide-react";
import * as React from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { DishImage } from "@/components/dish-image";
import { Badge, toneDotClass } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { TABLE_STATUS_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSpacePath } from "@/providers/space";
import { useApplyOrder, useOperations, useTenant } from "../hooks";
import { useOrder } from "../orders/order-detail-page";
import { orderPlace } from "../orders/order-bits";
import { useTables } from "../tables/tables-page";
import { cartCount, cartReducer, cartTotals, toOrderItems, type CartLine } from "./cart";
import { CartPanel } from "./cart-panel";
import { OptionSheet } from "./option-sheet";

/** Carte du restaurant (cache partagé : menu, prise de commande, écran cuisine). */
export function useMenu() {
  const t = useTenant();
  return useQuery({ queryKey: tenantKeys.menu(t.root), queryFn: t.api.menu.get, staleTime: 60_000 });
}

function useDraft(key: string) {
  const read = (): CartLine[] => {
    try { const v = sessionStorage.getItem(key); return v ? (JSON.parse(v) as CartLine[]) : []; } catch { return []; }
  };
  const [lines, setLines] = React.useState<CartLine[]>(read);
  React.useEffect(() => {
    try { if (lines.length) sessionStorage.setItem(key, JSON.stringify(lines)); else sessionStorage.removeItem(key); } catch { /* stockage indisponible */ }
  }, [key, lines]);
  return [lines, setLines] as const;
}

/**
 * Prise de commande (tablettes de salle d'abord) : table ou « à emporter », catégories, plats, options,
 * panier avec totaux en direct (calcul partagé avec l'API), envoi en cuisine. Sert aussi à « Ajouter à la commande ».
 */
export function PosPage() {
  const { id: orderId } = useParams();
  const [params] = useSearchParams();
  const t = useTenant();
  const to = useSpacePath();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ops = useOperations();
  const apply = useApplyOrder();
  const menu = useMenu();
  const tables = useTables();
  const existing = useOrder(orderId);
  const adding = !!orderId;

  const [lines, setLines] = useDraft(`pos:${t.slug}:${orderId ?? "new"}`);
  const dispatch = React.useCallback((a: Parameters<typeof cartReducer>[1]) => setLines((l) => cartReducer(l, a)), [setLines]);
  const [type, setType] = React.useState<"DINE_IN" | "TAKEAWAY">(params.get("type") === "TAKEAWAY" ? "TAKEAWAY" : "DINE_IN");
  const [tableId, setTableId] = React.useState<string | null>(params.get("table"));
  const [customer, setCustomer] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [search, setSearch] = React.useState("");
  const [optionsFor, setOptionsFor] = React.useState<MenuItem | null>(null);
  const [pickTable, setPickTable] = React.useState(false);
  const [cartOpen, setCartOpen] = React.useState(false);

  const categories = (menu.data ?? []).filter((c) => c.isActive && c.items.length);
  const allItems = categories.flatMap((c) => c.items);
  const currentCat = categories.find((c) => c.id === category) ?? categories[0];
  const needle = search.trim().toLowerCase();
  const shown = needle ? allItems.filter((i) => i.name.toLowerCase().includes(needle)) : currentCat?.items ?? [];
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const unavailable = new Set(lines.filter((l) => byId.size && !byId.get(l.menuItemId)?.isAvailable).map((l) => l.menuItemId));
  const inCart = (id: string) => lines.filter((l) => l.menuItemId === id).reduce((n, l) => n + l.quantity, 0);
  const totals = cartTotals(lines, ops);
  const table = tables.data?.find((x) => x.id === tableId) ?? null;

  const pick = (item: MenuItem) => {
    if (!item.isAvailable) return;
    if (item.optionGroups.length) setOptionsFor(item);
    else dispatch({ type: "add", item });
  };

  const onConflict = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409 && /plus disponible/i.test(e.message)) {
      toast.error(e.message, { description: "La carte a été mise à jour : retirez ce plat du panier ou choisissez-en un autre." });
      void qc.invalidateQueries({ queryKey: tenantKeys.menu(t.root) });
      return true;
    }
    return false;
  };

  const send = useMutation({
    mutationFn: async () => {
      const items = toOrderItems(lines);
      if (adding) {
        const body = addItemsSchema.parse({ items });
        return { order: await t.api.orders.addItems(orderId!, body.items), added: cartCount(lines) };
      }
      const parsed = createOrderSchema.safeParse({
        type, tableId: type === "DINE_IN" ? table?.id : undefined, customerName: type === "TAKEAWAY" ? customer : undefined, notes, items,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Commande incomplète");
      return { order: await t.api.orders.create(parsed.data), added: cartCount(lines) };
    },
    onSuccess: ({ order, added }) => {
      apply(order);
      setLines([]);
      toast.success(adding ? `${added} article${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""} à la commande n°${order.number}` : `Commande n°${order.number} envoyée en cuisine`,
        { description: orderPlace(order) });
      navigate(to(`/commandes/${order.id}`), { replace: true });
    },
    onError: (e) => { if (!onConflict(e)) toastError(e); },
  });

  const submit = () => {
    if (!adding && type === "DINE_IN" && !table) { setPickTable(true); toast.message("Choisissez une table", { description: "Ou passez la commande en « À emporter »." }); return; }
    send.mutate();
  };

  const back = () => {
    if (adding) navigate(to(`/commandes/${orderId}`));
    else if (window.history.state?.idx > 0) navigate(-1);
    else navigate(to("/"));
  };
  const closedOrder = adding && existing.data && (existing.data.closedAt || existing.data.cancelledAt);
  const count = cartCount(lines);
  const submitLabel = adding ? `Ajouter · ${formatFcfa(totals.subtotal)}` : `Envoyer en cuisine · ${formatFcfa(totals.total)}`;

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Barre du haut */}
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-2 sm:flex-nowrap sm:px-3">
        <Button variant="ghost" size="icon" onClick={back} aria-label="Retour"><ArrowLeft /></Button>
        <div className="flex min-w-0 flex-col leading-tight">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">{adding ? `Ajouter à la commande n°${existing.data?.number ?? "…"}` : "Nouvelle commande"}</h1>
          {adding && existing.data && <span className="truncate text-xs text-muted-foreground">{orderPlace(existing.data)}</span>}
        </div>
        {!adding && (
          <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
            <Segmented ariaLabel="Type de commande" size="sm" value={type} onChange={setType} className="w-auto min-w-0 flex-1 sm:flex-none"
              options={[
                { value: "DINE_IN", label: "Sur place", icon: <span className="hidden sm:inline-flex"><LayoutGrid /></span> },
                ...(ops.takeawayEnabled ? [{ value: "TAKEAWAY" as const, label: "À emporter", icon: <span className="hidden sm:inline-flex"><ShoppingBag /></span> }] : []),
              ]} />
            {type === "DINE_IN" ? (
              <Button variant={table ? "secondary" : "primary"} onClick={() => setPickTable(true)} className="min-w-0 shrink-0">
                <LayoutGrid /> {table ? <>Table <span className="font-mono">{table.label}</span></> : <><span className="sm:hidden">Table</span><span className="hidden sm:inline">Choisir la table</span></>}
              </Button>
            ) : (
              <Input aria-label="Nom du client" placeholder="Nom du client" value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={60} className="min-w-0 sm:w-48" />
            )}
          </div>
        )}
      </header>

      {closedOrder ? (
        <div className="p-6"><ErrorState error={new Error("Cette commande est clôturée ou annulée : impossible d'y ajouter des articles.")} /></div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* Carte */}
          <div className="flex min-h-0 flex-col">
            <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
              <Input leading={<Search />} placeholder="Rechercher un plat…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher un plat"
                trailing={search ? <Button variant="ghost" size="icon-sm" aria-label="Effacer la recherche" onClick={() => setSearch("")}><X /></Button> : undefined} />
              {!needle && (
                <div role="tablist" aria-label="Catégories" className="-mx-3 flex gap-2 overflow-x-auto px-3 scrollbar-none">
                  {menu.isLoading ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-11 w-24 shrink-0 rounded-full" />) : categories.map((c) => {
                    const on = c.id === currentCat?.id;
                    return (
                      <button key={c.id} role="tab" aria-selected={on} type="button" onClick={() => setCategory(c.id)}
                        className={cn("flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          on ? "border-transparent bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground")}>
                        {c.name}<span className={cn("font-mono text-[11px] tabular-nums", on ? "text-background/70" : "text-faint")}>{c.items.length}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24 md:pb-3">
              {menu.isError ? <ErrorState error={menu.error} onRetry={() => menu.refetch()} /> : menu.isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-48 rounded-lg" />)}</div>
              ) : shown.length === 0 ? (
                <EmptyState icon={<UtensilsCrossed />} title={needle ? "Aucun plat trouvé" : "Aucun plat"} description={needle ? `Aucun plat ne contient « ${search} ».` : "Ajoutez des plats depuis l'écran Menu."} />
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                  {shown.map((item) => <li key={item.id}><DishTile item={item} count={inCart(item.id)} onPick={() => pick(item)} /></li>)}
                </ul>
              )}
            </div>
          </div>

          {/* Panier (tablette / bureau) */}
          <CartPanel
            className="hidden border-l border-border md:flex"
            lines={lines} dispatch={dispatch} totals={totals} serviceChargePercent={ops.serviceChargePercent} unavailable={unavailable}
            notes={adding ? undefined : { value: notes, onChange: setNotes }}
            submitLabel={submitLabel} onSubmit={submit} submitting={send.isPending}
          />
        </div>
      )}

      {/* Panier (téléphone) : barre en bas, à portée de pouce */}
      {!closedOrder && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <Button variant="primary" size="lg" className="h-12 w-full justify-between" onClick={() => setCartOpen(true)} disabled={!lines.length}>
            <span className="flex items-center gap-2"><ShoppingCart /> Panier <span className="font-mono">({count})</span></span>
            <span className="font-mono tabular-nums">{formatFcfa(adding ? totals.subtotal : totals.total)}</span>
          </Button>
        </div>
      )}
      <Dialog open={cartOpen} onOpenChange={setCartOpen} title={`Panier · ${count} article${count > 1 ? "s" : ""}`} className="md:hidden">
        <CartPanel
          hideHeader
          className="-mx-5 -my-4 max-h-[75dvh]"
          lines={lines} dispatch={dispatch} totals={totals} serviceChargePercent={ops.serviceChargePercent} unavailable={unavailable}
          notes={adding ? undefined : { value: notes, onChange: setNotes }}
          submitLabel={submitLabel} onSubmit={() => { setCartOpen(false); submit(); }} submitting={send.isPending}
        />
      </Dialog>

      <OptionSheet item={optionsFor} onClose={() => setOptionsFor(null)} onAdd={(item, c) => {
        dispatch({ type: "add", item, optionIds: c.optionIds, quantity: c.quantity, instructions: c.instructions, course: c.course });
        setOptionsFor(null);
      }} />
      <TablePicker open={pickTable} onOpenChange={setPickTable} tables={tables.data ?? []} loading={tables.isLoading} error={tables.error}
        value={tableId} onPick={(id) => { setTableId(id); setPickTable(false); }} />
    </div>
  );
}

function DishTile({ item, count, onPick }: { item: MenuItem; count: number; onPick: () => void }) {
  const off = !item.isAvailable;
  const badges = (
    <>
      {off && <Badge tone="red" dot>Épuisé</Badge>}
      {!off && item.isDishOfDay && <Badge tone="amber"><Star className="size-3" /> Plat du jour</Badge>}
    </>
  );
  const qty = count > 0 && (
    <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-brand px-2 font-mono text-sm font-semibold text-brand-foreground shadow-sm tabular-nums">{count}</span>
  );
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={off}
      aria-label={`${item.name}, ${formatFcfa(item.price)}${off ? ", épuisé" : ""}${count ? `, ${count} dans le panier` : ""}`}
      className={cn(
        "group relative flex h-full min-h-[120px] w-full flex-col overflow-hidden rounded-lg border bg-card text-left shadow-xs transition-[border-color,box-shadow,transform] active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        count ? "border-brand-ink ring-1 ring-brand-ink" : "border-border hover:border-border-strong hover:shadow-sm",
        off && "cursor-not-allowed bg-subtle active:scale-100",
      )}
    >
      {item.imageUrl && (
        <div className="relative">
          <DishImage src={item.imageUrl} className={cn("aspect-[4/3] w-full", off && "opacity-40 grayscale")} iconClassName="size-6" />
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">{badges}</div>
          {qty && <span className="absolute right-2 top-2">{qty}</span>}
        </div>
      )}
      <div className={cn("flex flex-1 flex-col gap-1.5 p-3", off && "opacity-60")}>
        {!item.imageUrl && (off || item.isDishOfDay || count > 0) && (
          <div className="flex min-h-7 items-start justify-between gap-2"><span className="flex flex-wrap gap-1">{badges}</span>{qty}</div>
        )}
        <span className="line-clamp-2 text-[15px] font-medium leading-snug">{item.name}</span>
        <span className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="font-mono text-sm font-semibold tabular-nums">{formatFcfa(item.price)}</span>
          {item.optionGroups.length > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Layers className="size-3" /> Options</span>}
        </span>
      </div>
    </button>
  );
}

function TablePicker({ open, onOpenChange, tables, loading, error, value, onPick }: {
  open: boolean; onOpenChange: (o: boolean) => void; tables: DiningTable[]; loading: boolean; error: unknown; value: string | null; onPick: (id: string) => void;
}) {
  const active = tables.filter((x) => x.isActive);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Choisir la table" description="Les tables occupées peuvent recevoir une commande supplémentaire." size="lg">
      {error ? <ErrorState error={error} compact /> : loading ? <Skeleton className="h-40" /> : active.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune table : demandez à un responsable de les créer, ou passez en « À emporter ».</p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {active.map((x) => {
            const on = x.id === value;
            return (
              <li key={x.id}>
                <button type="button" onClick={() => onPick(x.id)} aria-pressed={on}
                  className={cn("relative flex h-20 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on ? "border-brand-ink bg-brand-tint" : "border-border hover:bg-hover")}>
                  <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", toneDotClass[tableStatusTone(x.status)])} />
                  <span className="font-mono text-lg font-semibold">{x.label}</span>
                  <span className="text-[11px] text-muted-foreground">{x.openOrders.length ? `n°${x.openOrders.map((o) => o.number).join(", n°")}` : TABLE_STATUS_LABEL[x.status]} · {x.capacity} pl.</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p className="sr-only">{errorMessage(error)}</p> : null}
    </Dialog>
  );
}
