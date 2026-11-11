import { zodResolver } from "@hookform/resolvers/zod";
import type { Ingredient, PurchaseOrder, Supplier } from "@restaurant/api-client";
import { purchaseStatusTone } from "@restaurant/ui-tokens";
import { purchaseLineTotal, roundQty } from "@restaurant/utils";
import { supplierInputSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, PackageCheck, Pencil, Plus, Send, Trash2, Truck, X } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { formatDate, formatFcfa, formatQty } from "@/lib/format";
import { PURCHASE_STATUS_LABEL, STOCK_UNIT_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useTenant } from "../hooks";
import { useRefreshStock } from "./stock-dialogs";
import { parseQty, useIngredients, useSuppliers } from "./stock-hooks";

/** Fournisseurs et commandes fournisseurs (brouillon → envoyée → reçue en partie / reçue). Écriture : responsables. */
export function SuppliersPage() {
  const t = useTenant();
  const [tab, setTab] = useUrlParam("onglet", "commandes");
  const [params, setParams] = useSearchParams();
  const [supplierEdit, setSupplierEdit] = React.useState<{ supplier: Supplier | null } | null>(null);
  const [po, setPo] = React.useState<{ order: PurchaseOrder | null; prefill?: string[] } | null>(null);
  const [view, setView] = React.useState<string | null>(null);

  // Création depuis les alertes (`?nouvelle=alertes`) ou depuis un ingrédient (`?nouvelle=<id>`).
  React.useEffect(() => {
    const from = params.get("nouvelle");
    if (!from || !t.isManager) return;
    setPo({ order: null, prefill: from === "alertes" ? ["alertes"] : [from] });
    params.delete("nouvelle");
    setParams(params, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Fournisseurs"
        description="Commandes d'achat et réceptions : le stock et le coût moyen se mettent à jour à la réception."
        actions={t.isManager && (tab === "fournisseurs"
          ? <Button variant="primary" onClick={() => setSupplierEdit({ supplier: null })}><Plus /> Ajouter un fournisseur</Button>
          : <Button variant="primary" onClick={() => setPo({ order: null })}><Plus /> Nouvelle commande</Button>)}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v === "commandes" ? null : v)}>
        <TabsList>
          <TabsTrigger value="commandes">Commandes</TabsTrigger>
          <TabsTrigger value="fournisseurs">Fournisseurs</TabsTrigger>
        </TabsList>
        <TabsContent value="commandes" className="pt-5"><OrdersTab onOpen={(o) => setView(o.id)} onCreate={() => setPo({ order: null })} /></TabsContent>
        <TabsContent value="fournisseurs" className="pt-5"><SuppliersTab onEdit={(s) => setSupplierEdit({ supplier: s })} onCreate={() => setSupplierEdit({ supplier: null })} /></TabsContent>
      </Tabs>
      {t.isManager && <SupplierDialog value={supplierEdit} onClose={() => setSupplierEdit(null)} />}
      {t.isManager && <PurchaseOrderEditor value={po} onClose={() => setPo(null)} onSaved={(o) => setView(o.id)} />}
      <PurchaseOrderDialog id={view} onClose={() => setView(null)} onEdit={(o) => { setView(null); setPo({ order: o }); }} />
    </>
  );
}

function OrdersTab({ onOpen, onCreate }: { onOpen: (o: PurchaseOrder) => void; onCreate: () => void }) {
  const t = useTenant();
  const q = useQuery({ queryKey: tenantKeys.purchaseOrders(t.root), queryFn: () => t.api.purchaseOrders.list() });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const columns: Column<PurchaseOrder>[] = [
    { key: "date", header: "Créée le", cell: (o) => <span className="font-mono text-[13px] tabular-nums">{formatDate(o.createdAt)}</span> },
    { key: "supplier", header: "Fournisseur", cell: (o) => <span className="font-medium">{o.supplier.name}</span> },
    { key: "status", header: "État", cell: (o) => <Badge tone={purchaseStatusTone(o.status)} dot>{PURCHASE_STATUS_LABEL[o.status]}</Badge> },
    { key: "lines", header: "Articles", hideOnMobile: true, cell: (o) => <span className="text-muted-foreground">{o.lines.map((l) => l.ingredient.name).join(", ")}</span>, className: "max-w-[280px] truncate" },
    { key: "expected", header: "Livraison prévue", hideOnMobile: true, cell: (o) => <span className="text-muted-foreground">{o.expectedAt ? formatDate(o.expectedAt) : "—"}</span> },
    { key: "total", header: "Montant", align: "right", cell: (o) => <span className="font-mono tabular-nums">{formatFcfa(o.total)}</span> },
  ];
  return (
    <DataTable rows={q.data} loading={q.isLoading} columns={columns} rowKey={(o) => o.id} onRowClick={onOpen} caption="Commandes fournisseurs"
      empty={<EmptyState icon={<Truck />} title="Aucune commande fournisseur" description="Créez une commande depuis les alertes de stock ou à partir de zéro, puis enregistrez la réception."
        action={t.isManager ? <Button variant="primary" onClick={onCreate}><Plus /> Nouvelle commande</Button> : undefined} />} />
  );
}

function SuppliersTab({ onEdit, onCreate }: { onEdit: (s: Supplier) => void; onCreate: () => void }) {
  const t = useTenant();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useSuppliers();
  const remove = useMutation({
    mutationFn: (s: Supplier) => t.api.suppliers.remove(s.id),
    onSuccess: (r, s) => { void qc.invalidateQueries({ queryKey: tenantKeys.suppliers(t.root) }); toast.success(r.archived ? `« ${s.name} » archivé (historique conservé)` : `« ${s.name} » supprimé`); },
    onError: (e) => toastError(e),
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <DataTable rows={q.data} loading={q.isLoading} rowKey={(s) => s.id} onRowClick={t.isManager ? onEdit : undefined} caption="Fournisseurs"
      columns={[
        { key: "name", header: "Fournisseur", cell: (s) => <div className="flex flex-col"><span className="font-medium">{s.name}</span><span className="text-[12.5px] text-muted-foreground">{s.contact ?? "—"}</span></div> },
        { key: "phone", header: "Téléphone", cell: (s) => s.phone ? <a href={`tel:${s.phone}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[13px] tabular-nums hover:underline">{s.phone}</a> : <span className="text-muted-foreground">—</span> },
        { key: "email", header: "Email", hideOnMobile: true, cell: (s) => <span className="text-muted-foreground">{s.email ?? "—"}</span> },
        { key: "ingredients", header: "Ingrédients", align: "right", cell: (s) => <span className="font-mono tabular-nums">{s.ingredientCount}</span> },
      ]}
      rowActions={t.isManager ? (s) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={`Modifier ${s.name}`} onClick={(e) => { e.stopPropagation(); onEdit(s); }}><Pencil /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={`Retirer ${s.name}`} onClick={(e) => {
            e.stopPropagation();
            confirm({ title: `Retirer « ${s.name} » ?`, description: "S'il a déjà des ingrédients ou des commandes, il est archivé (historique conservé) ; sinon il est supprimé.", confirmLabel: "Retirer", onConfirm: () => remove.mutateAsync(s) });
          }}><Archive /></Button>
        </div>
      ) : undefined}
      empty={<EmptyState icon={<Truck />} title="Aucun fournisseur" description="Ajoutez vos fournisseurs habituels (marché, grossiste, boucher…) pour préparer vos commandes."
        action={t.isManager ? <Button variant="primary" onClick={onCreate}><Plus /> Ajouter un fournisseur</Button> : undefined} />} />
  );
}

type SupplierValues = z.input<typeof supplierInputSchema>;

function SupplierDialog({ value, onClose }: { value: { supplier: Supplier | null } | null; onClose: () => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const s = value?.supplier ?? null;
  const form = useForm<SupplierValues>({ resolver: zodResolver(supplierInputSchema) });
  React.useEffect(() => {
    if (value) form.reset({ name: s?.name ?? "", contact: s?.contact ?? "", phone: s?.phone ?? "", email: s?.email ?? "", address: s?.address ?? "", notes: s?.notes ?? "" });
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: (v: z.output<typeof supplierInputSchema>) => s
      ? t.api.suppliers.update(s.id, { name: v.name, contact: v.contact ?? null, phone: v.phone ?? null, email: v.email ?? null, address: v.address ?? null, notes: v.notes ?? null })
      : t.api.suppliers.create(v),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: tenantKeys.suppliers(t.root) }); toast.success(s ? `« ${r.name} » enregistré` : `« ${r.name} » ajouté`); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) }); },
  });
  const submit = form.handleSubmit((v) => save.mutate(v as z.output<typeof supplierInputSchema>));
  const err = form.formState.errors;
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={s ? `Modifier « ${s.name} »` : "Ajouter un fournisseur"}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={submit}>{s ? "Enregistrer" : "Ajouter le fournisseur"}</Button></>}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {err.root && <Callout tone="danger">{err.root.message}</Callout>}
        <Field label="Nom" required error={err.name?.message}><Input autoFocus maxLength={80} placeholder="Marché d'Adawlato" {...form.register("name")} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact" error={err.contact?.message}><Input maxLength={80} {...form.register("contact")} /></Field>
          <Field label="Téléphone" error={err.phone?.message}><Input type="tel" inputMode="tel" placeholder="+228 90 00 00 00" {...form.register("phone")} /></Field>
        </div>
        <Field label="Email" error={err.email?.message}><Input type="email" inputMode="email" {...form.register("email")} /></Field>
        <Field label="Adresse" error={err.address?.message}><Input maxLength={200} {...form.register("address")} /></Field>
        <Field label="Notes" error={err.notes?.message}><Textarea maxLength={300} className="min-h-[64px]" {...form.register("notes")} /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

type DraftLine = { ingredientId: string; quantity: string; unitCost: number | null };
const toInput = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

/** Brouillon de commande fournisseur ; pré-rempli depuis les alertes (quantités suggérées, coût moyen). */
function PurchaseOrderEditor({ value, onClose, onSaved }: { value: { order: PurchaseOrder | null; prefill?: string[] } | null; onClose: () => void; onSaved: (o: PurchaseOrder) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const ingredients = useIngredients();
  const [supplierId, setSupplierId] = React.useState("");
  const [expectedAt, setExpectedAt] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const order = value?.order ?? null;

  React.useEffect(() => {
    if (!value) return;
    setError(null);
    if (order) {
      setSupplierId(order.supplier.id); setExpectedAt(order.expectedAt?.slice(0, 10) ?? ""); setNotes(order.notes ?? "");
      setLines(order.lines.map((l) => ({ ingredientId: l.ingredient.id, quantity: toInput(l.quantity), unitCost: l.unitCost })));
      return;
    }
    setExpectedAt(""); setNotes("");
    const all = ingredients.data ?? [];
    const picked: Ingredient[] = value.prefill?.[0] === "alertes" ? all.filter((i) => i.state !== "OK") : all.filter((i) => value.prefill?.includes(i.id));
    // Fournisseur le plus fréquent parmi les ingrédients choisis ; on ne garde que ses ingrédients (+ ceux sans fournisseur).
    const counts = new Map<string, number>();
    for (const i of picked) if (i.supplier) counts.set(i.supplier.id, (counts.get(i.supplier.id) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    setSupplierId(best);
    const suggest = (i: Ingredient) => i.reorderQty ?? (i.lowStockThreshold > 0 ? roundQty(2 * i.lowStockThreshold - i.quantity) : null);
    const kept = picked.filter((i) => !best || !i.supplier || i.supplier.id === best);
    setLines(kept.length ? kept.map((i) => ({ ingredientId: i.id, quantity: toInput(suggest(i)), unitCost: i.avgCost || null })) : [{ ingredientId: "", quantity: "", unitCost: null }]);
  }, [value, ingredients.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = lines.map((l) => ({ ingredientId: l.ingredientId, quantity: parseQty(l.quantity) ?? 0, unitCost: l.unitCost ?? 0 }));
  const total = parsed.reduce((s, l) => s + purchaseLineTotal(l.quantity, l.unitCost), 0);
  const valid = !!supplierId && parsed.length > 0 && parsed.every((l) => l.ingredientId && l.quantity > 0) && new Set(parsed.map((l) => l.ingredientId)).size === parsed.length;

  const save = useMutation({
    mutationFn: () => {
      const body = { supplierId, expectedAt: expectedAt ? new Date(`${expectedAt}T12:00:00`) : undefined, notes: notes || undefined, lines: parsed };
      return order ? t.api.purchaseOrders.update(order.id, { ...body, expectedAt: body.expectedAt ?? null, notes: notes || null }) : t.api.purchaseOrders.create(body);
    },
    onSuccess: (o) => { void qc.invalidateQueries({ queryKey: tenantKeys.purchaseOrders(t.root) }); toast.success(order ? "Commande enregistrée" : `Brouillon créé pour ${o.supplier.name}`); onClose(); onSaved(o); },
    onError: (e) => setError(errorMessage(e)),
  });
  const ingById = new Map((ingredients.data ?? []).map((i) => [i.id, i]));
  const set = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} size="lg" title={order ? "Modifier la commande" : "Nouvelle commande fournisseur"}
      description="Enregistrée en brouillon : envoyez-la au fournisseur, puis saisissez la réception à la livraison."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>{order ? "Enregistrer" : "Créer le brouillon"}</Button></>}>
      <div className="flex flex-col gap-4">
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fournisseur" required>
            <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choisir…</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Livraison prévue"><Input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></Field>
        </div>
        <div className="flex flex-col gap-2">
          <div className="hidden grid-cols-[1fr_120px_150px_40px] gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Ingrédient</span><span>Quantité</span><span>Prix unitaire</span><span />
          </div>
          {lines.map((l, i) => {
            const ing = ingById.get(l.ingredientId);
            return (
              <div key={i} className="grid grid-cols-[1fr_40px] gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_120px_150px_40px] sm:border-0 sm:p-0">
                <NativeSelect aria-label="Ingrédient" value={l.ingredientId} onChange={(e) => set(i, { ingredientId: e.target.value, unitCost: l.unitCost ?? (ingById.get(e.target.value)?.avgCost || null) })}>
                  <option value="">Choisir…</option>
                  {ingredients.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </NativeSelect>
                <Button variant="ghost" size="icon" className="sm:order-last" aria-label="Retirer la ligne" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))} disabled={lines.length === 1}><X /></Button>
                <Input aria-label="Quantité" inputMode="decimal" className="font-mono tabular-nums" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })}
                  trailing={ing && <span className="pr-3 text-xs text-muted-foreground">{STOCK_UNIT_LABEL[ing.unit]}</span>} />
                <MoneyInput aria-label="Prix unitaire" value={l.unitCost} onValueChange={(v) => set(i, { unitCost: v })} />
              </div>
            );
          })}
          <Button variant="secondary" className="self-start" onClick={() => setLines((ls) => [...ls, { ingredientId: "", quantity: "", unitCost: null }])}><Plus /> Ajouter une ligne</Button>
        </div>
        <Field label="Notes"><Textarea maxLength={300} className="min-h-[64px]" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Total estimé</span>
          <span className="font-mono text-base font-semibold tabular-nums">{formatFcfa(total)}</span>
        </div>
      </div>
    </Dialog>
  );
}

/** Détail d'une commande fournisseur : envoi, réception (partielle ou totale), annulation. */
function PurchaseOrderDialog({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (o: PurchaseOrder) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refresh = useRefreshStock();
  const q = useQuery({ queryKey: [...tenantKeys.purchaseOrders(t.root), id], queryFn: () => t.api.purchaseOrders.get(id!), enabled: !!id });
  const [receiving, setReceiving] = React.useState<Record<string, { qty: string; cost: number | null }> | null>(null);
  React.useEffect(() => setReceiving(null), [id]);
  const o = q.data;
  const done = (r: PurchaseOrder, msg: string) => {
    qc.setQueryData([...tenantKeys.purchaseOrders(t.root), r.id], r);
    void qc.invalidateQueries({ queryKey: tenantKeys.purchaseOrders(t.root), exact: true });
    toast.success(msg);
  };
  const send = useMutation({ mutationFn: () => t.api.purchaseOrders.send(o!.id), onSuccess: (r) => done(r, "Commande marquée comme envoyée"), onError: (e) => toastError(e) });
  const cancel = useMutation({ mutationFn: () => t.api.purchaseOrders.cancel(o!.id), onSuccess: (r) => done(r, "Commande annulée") });
  const receive = useMutation({
    mutationFn: () => t.api.purchaseOrders.receive(o!.id, {
      lines: Object.entries(receiving!).map(([lineId, v]) => ({ lineId, quantity: parseQty(v.qty) ?? 0, unitCost: v.cost ?? undefined })).filter((l) => l.quantity > 0),
    }),
    onSuccess: (r) => { void refresh(); setReceiving(null); done(r, r.status === "RECEIVED" ? "Réception enregistrée : commande soldée" : "Réception partielle enregistrée"); },
    onError: (e) => toastError(e),
  });
  const startReceive = () => setReceiving(Object.fromEntries(o!.lines.map((l) => [l.id, { qty: toInput(Math.max(0, roundQty(l.quantity - l.receivedQty))), cost: l.unitCost }])));
  const canReceive = o && ["DRAFT", "SENT", "PARTIAL"].includes(o.status);
  const receiveValid = receiving && Object.values(receiving).some((v) => (parseQty(v.qty) ?? 0) > 0) && Object.values(receiving).every((v) => v.qty === "" || (parseQty(v.qty) ?? -1) >= 0);

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} size="lg" title={o ? `Commande — ${o.supplier.name}` : "Commande fournisseur"}
      description={o ? `Créée le ${formatDate(o.createdAt)}${o.expectedAt ? ` · livraison prévue le ${formatDate(o.expectedAt)}` : ""}` : undefined}
      footer={o && t.isManager ? (
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {o.status !== "RECEIVED" && o.status !== "CANCELLED" && !receiving ? (
            <Button variant="danger-ghost" onClick={() => confirm({ title: "Annuler cette commande ?", description: o.status === "PARTIAL" ? "Ce qui a déjà été reçu reste en stock ; le reste ne sera plus attendu." : "Elle reste visible dans l'historique.", confirmLabel: "Annuler la commande", onConfirm: () => cancel.mutateAsync() })}><Trash2 /> Annuler la commande</Button>
          ) : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {receiving ? (
              <>
                <Button variant="ghost" onClick={() => setReceiving(null)}>Retour</Button>
                <Button variant="primary" disabled={!receiveValid} loading={receive.isPending} onClick={() => receive.mutate()}><PackageCheck /> Enregistrer la réception</Button>
              </>
            ) : (
              <>
                {o.status === "DRAFT" && <Button variant="secondary" onClick={() => onEdit(o)}><Pencil /> Modifier</Button>}
                {o.status === "DRAFT" && <Button variant="secondary" loading={send.isPending} onClick={() => send.mutate()}><Send /> Marquer comme envoyée</Button>}
                {canReceive && <Button variant="primary" onClick={startReceive}><PackageCheck /> Réceptionner</Button>}
              </>
            )}
          </div>
        </div>
      ) : undefined}>
      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !o ? <div className="h-40" /> : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={purchaseStatusTone(o.status)} dot>{PURCHASE_STATUS_LABEL[o.status]}</Badge>
            {o.supplier.phone && <a href={`tel:${o.supplier.phone}`} className="font-mono text-[13px] text-muted-foreground hover:underline">{o.supplier.phone}</a>}
          </div>
          {receiving && <Callout tone="info">Saisissez les quantités livrées et corrigez le prix si besoin : le stock et le coût moyen pondéré sont mis à jour.</Callout>}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {o.lines.map((l) => (
              <li key={l.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{l.ingredient.name}</span>
                  <span className="font-mono text-[12.5px] text-muted-foreground tabular-nums">
                    {formatQty(l.quantity, l.ingredient.unit)} × {formatFcfa(l.unitCost)}{l.receivedQty > 0 && ` · reçu ${formatQty(l.receivedQty, l.ingredient.unit)}`}
                  </span>
                </div>
                {receiving ? (
                  <div className="grid grid-cols-2 gap-2 sm:w-72">
                    <Input aria-label={`Quantité reçue : ${l.ingredient.name}`} inputMode="decimal" className="font-mono tabular-nums" value={receiving[l.id]?.qty ?? ""}
                      onChange={(e) => setReceiving((r) => ({ ...r!, [l.id]: { ...r![l.id]!, qty: e.target.value } }))}
                      trailing={<span className="pr-3 text-xs text-muted-foreground">{STOCK_UNIT_LABEL[l.ingredient.unit]}</span>} />
                    <MoneyInput aria-label={`Prix réel : ${l.ingredient.name}`} value={receiving[l.id]?.cost ?? null} onValueChange={(v) => setReceiving((r) => ({ ...r!, [l.id]: { ...r![l.id]!, cost: v } }))} />
                  </div>
                ) : <span className="font-mono tabular-nums sm:text-right">{formatFcfa(l.total)}</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">{o.receivedValue > 0 ? <>Reçu : <span className="font-mono text-foreground">{formatFcfa(o.receivedValue)}</span></> : "Total"}</span>
            <span className="font-mono text-base font-semibold tabular-nums">{formatFcfa(o.total)}</span>
          </div>
          {o.notes && <p className="text-sm text-muted-foreground">{o.notes}</p>}
        </div>
      )}
    </Dialog>
  );
}
