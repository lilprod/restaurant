import type { MenuCategory, MenuItem } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, BookOpen, Clock, Eye, EyeOff, ExternalLink, Layers, MoreHorizontal, Pencil, Plus, Star, Trash2, TriangleAlert,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { DishImage } from "@/components/dish-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { errorMessage, toastError } from "@/lib/errors";
import { formatFcfa } from "@/lib/format";
import { tenantKeys } from "@/lib/tenant-keys";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { useMenu } from "../pos/pos-page";
import { ItemEditor } from "./item-editor";

/** Menu : catégories (créer, renommer, ordonner, masquer) et plats. La cuisine n'y gère que la disponibilité. */
export function MenuPage() {
  const t = useTenant();
  const to = useSpacePath();
  const qc = useQueryClient();
  const menu = useMenu();
  const allergens = useQuery({ queryKey: tenantKeys.allergens(t.root), queryFn: t.api.menu.allergens, staleTime: Infinity, enabled: t.isManager });
  const [catParam, setCat] = useUrlParam("categorie", "");
  const [editor, setEditor] = React.useState<{ item: MenuItem | null; categoryId: string } | null>(null);
  const [catDialog, setCatDialog] = React.useState<MenuCategory | "new" | null>(null);
  const canEdit = t.isManager;
  const cats = menu.data ?? [];
  const current = cats.find((c) => c.id === catParam) ?? cats[0];
  const key = tenantKeys.menu(t.root);

  const setCats = (fn: (c: MenuCategory[]) => MenuCategory[]) => qc.setQueryData<MenuCategory[]>(key, (c) => (c ? fn(c) : c));
  const availability = useMutation({
    mutationFn: ({ item, value }: { item: MenuItem; value: boolean }) => t.api.menu.setAvailability(item.id, value),
    onMutate: ({ item, value }) => setCats((cs) => cs.map((c) => ({ ...c, items: c.items.map((i) => (i.id === item.id ? { ...i, isAvailable: value } : i)) }))),
    onSuccess: (i) => toast.success(i.isAvailable ? `« ${i.name} » disponible` : `« ${i.name} » marqué épuisé`),
    onError: (e) => { toastError(e); void qc.invalidateQueries({ queryKey: key }); },
  });
  const reorderItems = useMutation({
    mutationFn: (ids: string[]) => t.api.menu.reorderItems(ids),
    onError: (e) => { toastError(e); void qc.invalidateQueries({ queryKey: key }); },
  });
  const moveItem = (cat: MenuCategory, idx: number, dir: -1 | 1) => {
    const items = [...cat.items];
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j]!, items[idx]!];
    setCats((cs) => cs.map((c) => (c.id === cat.id ? { ...c, items } : c)));
    reorderItems.mutate(items.map((i) => i.id));
  };

  const catOut = current?.items.filter((i) => !i.isAvailable).length ?? 0;

  return (
    <>
      <PageHeader
        title={canEdit ? "Menu" : "Disponibilités"}
        description={canEdit ? "Catégories, plats, prix, options et allergènes. Les changements sont visibles tout de suite en salle et sur la carte publique." : "Marquez un plat « épuisé » pour qu'il ne puisse plus être commandé en salle."}
        actions={
          <>
            {canEdit && <Button asChild variant="secondary"><Link to={to("/carte")} target="_blank" rel="noreferrer"><ExternalLink /> Carte publique</Link></Button>}
            {canEdit && current && <Button variant="primary" onClick={() => setEditor({ item: null, categoryId: current.id })}><Plus /> Ajouter un plat</Button>}
          </>
        }
      />
      {menu.isError ? <ErrorState error={menu.error} onRetry={() => menu.refetch()} /> : menu.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]"><Skeleton className="h-72 rounded-lg" /><Skeleton className="h-96 rounded-lg" /></div>
      ) : cats.length === 0 ? (
        <Card><EmptyState icon={<BookOpen />} title="Votre carte est vide" description="Commencez par créer une catégorie (Entrées, Plats, Boissons…), puis ajoutez vos plats."
          action={canEdit ? <Button variant="primary" onClick={() => setCatDialog("new")}><Plus /> Nouvelle catégorie</Button> : undefined} /></Card>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[260px_1fr]">
          <CategoryList cats={cats} currentId={current?.id} onPick={(id) => setCat(id)} canEdit={canEdit} onEdit={setCatDialog} />
          {current && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">{current.name}{!current.isActive && <Badge tone="outline"><EyeOff className="size-3" /> Masquée</Badge>}</h2>
                  <p className="text-[13px] text-muted-foreground">{current.description || `${current.items.length} plat${current.items.length > 1 ? "s" : ""}`}{catOut > 0 && <> · <span className="text-[var(--tone-red-fg)]">{catOut} épuisé{catOut > 1 ? "s" : ""}</span></>}</p>
                </div>
              </div>
              {current.items.length === 0 ? (
                <EmptyState icon={<BookOpen />} title="Aucun plat dans cette catégorie" description="Ajoutez un premier plat avec sa photo, son prix et ses options."
                  action={canEdit ? <Button variant="primary" onClick={() => setEditor({ item: null, categoryId: current.id })}><Plus /> Ajouter un plat</Button> : undefined} />
              ) : (
                <ul className="divide-y divide-border">
                  {current.items.map((item, idx) => (
                    <li key={item.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", !item.isAvailable && "bg-subtle")}>
                      <button type="button" disabled={!canEdit} onClick={() => setEditor({ item, categoryId: current.id })}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
                        <DishImage src={item.imageUrl} className={cn("size-14 shrink-0 rounded-md", !item.isAvailable && "opacity-50 grayscale")} />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{item.name}</span>
                            {item.isDishOfDay && <Badge tone="amber" className="h-5 text-[11px]"><Star className="size-3" /> Plat du jour</Badge>}
                            {!item.isAvailable && <Badge tone="red" dot className="h-5 text-[11px]">Épuisé</Badge>}
                          </span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="font-mono font-medium text-foreground tabular-nums">{formatFcfa(item.price)}</span>
                            <span className="inline-flex items-center gap-1"><Clock className="size-3" />{item.prepMinutes} min</span>
                            <span className="hidden sm:inline">TVA {item.vatRate} %</span>
                            {item.optionGroups.length > 0 && <span className="inline-flex items-center gap-1"><Layers className="size-3" />{item.optionGroups.length} groupe{item.optionGroups.length > 1 ? "s" : ""} d'options</span>}
                            {item.allergens.length > 0 && <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3" />{item.allergens.map((a) => a.name).join(", ")}</span>}
                          </span>
                        </span>
                        {canEdit && <Pencil className="hidden size-4 shrink-0 text-faint sm:block" aria-hidden />}
                      </button>
                      <label className="flex shrink-0 items-center gap-2 text-[13px] text-muted-foreground">
                        <span className="hidden sm:inline">{item.isAvailable ? "Disponible" : "Épuisé"}</span>
                        <Switch checked={item.isAvailable} onCheckedChange={(v) => availability.mutate({ item, value: v })} aria-label={`${item.name} disponible`} />
                      </label>
                      {canEdit && (
                        <div className="hidden shrink-0 flex-col sm:flex">
                          <Button variant="ghost" size="icon-sm" className="h-6" aria-label={`Monter « ${item.name} »`} disabled={idx === 0} onClick={() => moveItem(current, idx, -1)}><ArrowUp /></Button>
                          <Button variant="ghost" size="icon-sm" className="h-6" aria-label={`Descendre « ${item.name} »`} disabled={idx === current.items.length - 1} onClick={() => moveItem(current, idx, 1)}><ArrowDown /></Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      )}
      {canEdit && <ItemEditor value={editor} categories={cats} allergens={allergens.data ?? []} onClose={() => setEditor(null)} />}
      {canEdit && <CategoryDialog value={catDialog} count={cats.length} onClose={() => setCatDialog(null)} onCreated={(id) => setCat(id)} />}
    </>
  );
}

function CategoryList({ cats, currentId, onPick, canEdit, onEdit }: {
  cats: MenuCategory[]; currentId?: string; onPick: (id: string) => void; canEdit: boolean; onEdit: (c: MenuCategory | "new") => void;
}) {
  const t = useTenant();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = tenantKeys.menu(t.root);
  const update = useMutation({
    mutationFn: ({ c, isActive }: { c: MenuCategory; isActive: boolean }) => t.api.menu.updateCategory(c.id, { isActive }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: key }); toast.success(c.isActive ? `« ${c.name} » visible sur la carte` : `« ${c.name} » masquée`); },
    onError: (e) => toastError(e),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => t.api.menu.reorderCategories(ids),
    onError: (e) => { toastError(e); void qc.invalidateQueries({ queryKey: key }); },
  });
  const remove = useMutation({
    mutationFn: (c: MenuCategory) => t.api.menu.deleteCategory(c.id),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: key }); toast.success(r.archived ? "Catégorie masquée (plats archivés rattachés)" : "Catégorie supprimée"); },
    onError: (e) => toastError(e),
  });
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...cats];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    qc.setQueryData(key, next);
    reorder.mutate(next.map((c) => c.id));
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Catégories</h2>
        {canEdit && <Button variant="ghost" size="icon-sm" aria-label="Nouvelle catégorie" onClick={() => onEdit("new")}><Plus /></Button>}
      </div>
      <ul className="flex gap-1 overflow-x-auto p-2 scrollbar-none lg:flex-col lg:overflow-visible">
        {cats.map((c, idx) => {
          const on = c.id === currentId;
          const out = c.items.filter((i) => !i.isAvailable).length;
          return (
            <li key={c.id} className="flex shrink-0 items-center gap-1 lg:shrink">
              <button type="button" onClick={() => onPick(c.id)} aria-current={on || undefined}
                className={cn("flex min-h-11 flex-1 items-center justify-between gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9",
                  on ? "bg-brand-tint font-medium text-brand-ink" : "text-muted-foreground hover:bg-hover hover:text-foreground")}>
                <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">{!c.isActive && <EyeOff className="size-3.5 shrink-0" aria-label="Masquée" />}<span className="truncate">{c.name}</span></span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                  {out > 0 && <span className="rounded-full bg-[var(--tone-red-bg)] px-1.5 text-[var(--tone-red-fg)]" title={`${out} épuisé(s)`}>{out} épuisé{out > 1 ? "s" : ""}</span>}
                  <span className="text-faint">{c.items.length}</span>
                </span>
              </button>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions pour ${c.name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => onEdit(c)}><Pencil /> Renommer</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => update.mutate({ c, isActive: !c.isActive })}>{c.isActive ? <><EyeOff /> Masquer de la carte</> : <><Eye /> Afficher sur la carte</>}</DropdownMenuItem>
                    <DropdownMenuItem disabled={idx === 0} onSelect={() => move(idx, -1)}><ArrowUp /> Monter</DropdownMenuItem>
                    <DropdownMenuItem disabled={idx === cats.length - 1} onSelect={() => move(idx, 1)}><ArrowDown /> Descendre</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => confirm({
                      title: `Supprimer la catégorie « ${c.name} » ?`,
                      description: c.items.length ? `Elle contient encore ${c.items.length} plat(s) : déplacez-les ou retirez-les d'abord.` : "La catégorie vide sera supprimée.",
                      confirmLabel: "Supprimer la catégorie",
                      onConfirm: () => remove.mutateAsync(c),
                    })}><Trash2 /> Supprimer</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function CategoryDialog({ value, count, onClose, onCreated }: { value: MenuCategory | "new" | null; count: number; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const editing = value && value !== "new" ? value : null;
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (value) { setName(editing?.name ?? ""); setDescription(editing?.description ?? ""); setError(null); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => editing
      ? t.api.menu.updateCategory(editing.id, { name: name.trim(), description: description.trim() })
      : t.api.menu.createCategory({ name: name.trim(), description: description.trim() || undefined, sortOrder: count }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: tenantKeys.menu(t.root) }); toast.success(editing ? "Catégorie enregistrée" : `Catégorie « ${c.name} » créée`); if (!editing) onCreated(c.id); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (e?: React.FormEvent) => { e?.preventDefault(); if (!name.trim()) { setError("Donnez un nom à la catégorie"); return; } save.mutate(); };
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} size="sm" title={editing ? "Renommer la catégorie" : "Nouvelle catégorie"}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={() => submit()}>{editing ? "Enregistrer" : "Créer la catégorie"}</Button></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Nom" required error={error ?? undefined}><Input autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Entrées, Grillades, Boissons…" /></Field>
        <Field label="Description" hint="Facultatif, affichée sur la carte publique."><Textarea maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[64px]" /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
