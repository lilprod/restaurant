import type { PublicMenuItem } from "@restaurant/api-client";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Star, TriangleAlert } from "lucide-react";
import * as React from "react";
import { useParams } from "react-router-dom";
import { publicSpace } from "@/app/spaces";
import { BrandMark } from "@/components/brand-mark";
import { DishImage } from "@/components/dish-image";
import { ThemeToggleButton } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import { resolveFromWindow } from "@/lib/tenant-slug";
import { useBranding } from "@/providers/branding";
import { groupRuleLabel } from "../tenant/pos/cart";

/** Carte publique (sans connexion) : aux couleurs du restaurant, pensée pour le téléphone et les réseaux lents. */
export function PublicMenuPage() {
  const params = useParams();
  const slug = (params.slug ?? resolveFromWindow()?.slug ?? "").toLowerCase();
  const { branding } = useBranding();
  const q = useQuery({ queryKey: ["public", "tenant-menu", slug], queryFn: () => publicSpace.tenantMenu(slug), enabled: !!slug, staleTime: 60_000 });
  const [active, setActive] = React.useState<string>("");
  const [open, setOpen] = React.useState<PublicMenuItem | null>(null);
  const navRef = React.useRef<HTMLDivElement>(null);
  const cats = q.data?.categories ?? [];

  React.useEffect(() => {
    if (branding) document.title = `Carte · ${branding.displayName}`;
  }, [branding]);

  // Catégorie visible → onglet actif (sans animation de défilement imposée).
  React.useEffect(() => {
    if (!cats.length) return;
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id.replace("cat-", ""));
    }, { rootMargin: "-120px 0px -60% 0px" });
    cats.forEach((c) => { const el = document.getElementById(`cat-${c.id}`); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [cats]);
  React.useEffect(() => {
    navRef.current?.querySelector<HTMLElement>(`[data-cat="${active}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-subtle">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4 px-4 pb-6 pt-8 sm:px-6 sm:pt-10">
          <div className="flex min-w-0 flex-col gap-3">
            <BrandMark size={44} />
            <div>
              <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">{branding?.displayName ?? q.data?.restaurant.name}</h1>
              {branding?.tagline && <p className="mt-1 text-[15px] text-muted-foreground">{branding.tagline}</p>}
            </div>
          </div>
          <ThemeToggleButton />
        </div>
      </header>

      {cats.length > 0 && (
        <nav aria-label="Catégories" className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
          <div ref={navRef} className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-2.5 scrollbar-none sm:px-6">
            {cats.map((c) => {
              const on = (active || cats[0]!.id) === c.id;
              return (
                <a key={c.id} href={`#cat-${c.id}`} data-cat={c.id} aria-current={on || undefined}
                  className={cn("flex h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors sm:h-9",
                    on ? "border-transparent bg-brand text-brand-foreground" : "border-border text-muted-foreground hover:bg-hover hover:text-foreground")}>
                  {c.name}
                </a>
              );
            })}
          </div>
        </nav>
      )}

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.isLoading ? (
          <div className="flex flex-col gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
        ) : cats.length === 0 ? (
          <EmptyState icon={<BookOpen />} title="La carte arrive bientôt" description="Aucun plat n'est disponible pour le moment. Revenez un peu plus tard." />
        ) : cats.map((c) => (
          <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-20 pb-8">
            <h2 className="font-brand text-xl font-semibold tracking-tight">{c.name}</h2>
            {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
            <ul className="mt-4 flex flex-col gap-3">
              {c.items.map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => setOpen(i)}
                    className="flex w-full items-start gap-4 rounded-lg border border-border bg-card p-3 text-left shadow-xs transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4">
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold leading-snug">{i.name}</span>
                        {i.isDishOfDay && <Badge tone="brand"><Star className="size-3" /> Plat du jour</Badge>}
                      </div>
                      {i.description && <p className="line-clamp-2 text-[13.5px] leading-relaxed text-muted-foreground">{i.description}</p>}
                      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                        <span className="font-mono text-[15px] font-semibold tabular-nums">{formatFcfa(i.price)}</span>
                        {i.optionGroups.length > 0 && <span className="text-xs text-muted-foreground">Au choix : {i.optionGroups.map((g) => g.name.toLowerCase()).join(", ")}</span>}
                      </div>
                      {i.allergens.length > 0 && (
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--tone-amber-fg)]">
                          <TriangleAlert className="size-3.5" aria-hidden /><span className="sr-only">Allergènes :</span>{i.allergens.map((a) => a.name).join(" · ")}
                        </p>
                      )}
                    </div>
                    {i.imageUrl && <DishImage src={i.imageUrl} alt="" className="size-24 shrink-0 rounded-md sm:size-28" />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <footer className="border-t border-border pt-6 text-center text-[13px] text-muted-foreground">
          Prix TTC en FCFA. Une allergie ? Signalez-la à notre équipe avant de commander.
        </footer>
      </main>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.name ?? ""} description={open ? <span className="font-mono">{formatFcfa(open.price)}</span> : undefined}>
        {open && (
          <div className="flex flex-col gap-5">
            {open.imageUrl && <DishImage src={open.imageUrl} loading="eager" className="aspect-[4/3] w-full rounded-lg" />}
            {open.description && <p className="text-sm leading-relaxed text-muted-foreground">{open.description}</p>}
            {open.optionGroups.map((g) => (
              <section key={g.id} className="flex flex-col gap-2">
                <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">{g.name}<Badge tone="outline">{groupRuleLabel(g)}</Badge></h3>
                <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {g.options.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <span>{o.name}</span><span className="font-mono text-[13px] text-muted-foreground tabular-nums">{o.extra ? `+${formatFcfa(o.extra)}` : "inclus"}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {open.allergens.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">Allergènes</h3>
                <div className="flex flex-wrap gap-1.5">{open.allergens.map((a) => <Badge key={a.code} tone="amber">{a.name}</Badge>)}</div>
              </section>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
