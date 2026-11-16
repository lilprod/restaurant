import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import * as React from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";

/** Séries catégorielles dans l'ordre fixe du skill dataviz : une couleur par moyen de paiement, quel que soit le filtre. */
export const METHOD_COLOR: Record<string, string> = {
  CASH: "var(--chart-1)", CARD: "var(--chart-2)", FLOOZ: "var(--chart-3)", TMONEY: "var(--chart-4)", OTHER: "var(--chart-muted)",
};

const AXIS = { fill: "var(--muted-foreground)", fontSize: 11, fontFamily: "var(--font-mono)" } as const;

/** Variation par rapport à la période précédente : signe + texte (jamais la couleur seule). `null` : base nulle. */
export function Delta({ now, before, inverse }: { now: number; before: number; inverse?: boolean }) {
  if (before === 0) return <span className="text-[12.5px] text-muted-foreground">{now === 0 ? "Stable" : "Nouveau"} vs période précédente</span>;
  const pct = Math.round(((now - before) / before) * 1000) / 10;
  const good = inverse ? pct < 0 : pct > 0;
  const Icon = pct === 0 ? Minus : pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground">
      <span className={cn("inline-flex items-center gap-0.5 font-mono font-medium tabular-nums", pct === 0 ? "" : good ? "text-[var(--tone-green-fg)]" : "text-[var(--tone-red-fg)]")}>
        <Icon className="size-3.5" aria-hidden />{pct > 0 ? "+" : ""}{String(pct).replace(".", ",")} %
      </span>
      vs période précédente
    </span>
  );
}

export interface BarRow { key: string; label: string; value: number; display: string; hint?: string; color?: string }

/** Barres horizontales : libellé, valeur en texte (lisible sans couleur ni survol) et barre fine à bout arrondi. */
export function HBarList({ rows, max, color = "var(--chart-1)", empty = "Aucune donnée sur la période." }: { rows: BarRow[]; max?: number; color?: string; empty?: string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-6">{empty}</p>;
  return (
    <ul className="flex flex-col gap-3 px-5 pb-5 sm:px-6 sm:pb-6">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1.5" title={r.hint}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-mono tabular-nums">{r.display}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / top) * 100)}%`, background: r.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number; payload: { sub?: string } }[]; label?: string; unit: "fcfa" | "count" }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2"><span className="h-0.5 w-3 rounded-full" style={{ background: "var(--chart-1)" }} aria-hidden /><span className="font-mono text-sm font-semibold tabular-nums">{unit === "fcfa" ? formatFcfa(p.value) : formatNumber(p.value)}</span></div>
      {p.payload.sub && <div className="mt-1 text-muted-foreground">{p.payload.sub}</div>}
    </div>
  );
}

/** Colonnes d'une seule série (ex. encaissé par jour, commandes par heure). Axe unique, grille discrète, 4 px arrondis en haut. */
export function ColumnChart({ data, unit, ariaLabel, height = 240 }: { data: { label: string; value: number; sub?: string }[]; unit: "fcfa" | "count"; ariaLabel: string; height?: number }) {
  return (
    <div style={{ height }} className="px-2 pb-4 sm:px-4" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} tick={AXIS} />
          <YAxis tickLine={false} axisLine={false} width={unit === "fcfa" ? 48 : 34} allowDecimals={false} tick={AXIS}
            tickFormatter={(v: number) => (unit !== "fcfa" ? String(v) : v >= 1_000_000 ? `${String(Math.round(v / 100_000) / 10).replace(".", ",")} M` : v >= 1000 ? `${Math.round(v / 1000)} k` : String(v))} />
          <Tooltip cursor={{ fill: "var(--hover)" }} content={<Tip unit={unit} />} />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={32} animationDuration={400} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAYS_LONG = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Carte de chaleur jour × heure : une teinte (bleu de la série 1), du clair au foncé ; valeur lue au survol, au focus ou en tableau. */
export function Heatmap({ cells, max }: { cells: { weekday: number; hour: number; orders: number }[]; max: number }) {
  const [focus, setFocus] = React.useState<{ weekday: number; hour: number; orders: number } | null>(null);
  const active = cells.filter((c) => c.orders > 0).map((c) => c.hour);
  const from = active.length ? Math.min(...active) : 8, to = active.length ? Math.max(...active) : 22;
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const at = (wd: number, h: number) => cells.find((c) => c.weekday === wd && c.hour === h)?.orders ?? 0;
  const label = (wd: number, h: number, n: number) => `${DAYS_LONG[wd - 1]} ${h} h : ${n} commande${n > 1 ? "s" : ""}`;
  return (
    <div className="px-5 pb-5 sm:px-6 sm:pb-6">
      <p className="mb-3 h-5 text-[13px] text-muted-foreground" aria-live="polite">
        {focus ? <><span className="font-medium text-foreground first-letter:uppercase">{DAYS_LONG[focus.weekday - 1]} {focus.hour} h</span> · <span className="font-mono tabular-nums">{focus.orders}</span> commande{focus.orders > 1 ? "s" : ""}</> : "Survolez une case pour lire la valeur."}
      </p>
      <div className="overflow-x-auto">
        <div className="grid min-w-[520px] gap-[2px]" style={{ gridTemplateColumns: `44px repeat(${hours.length}, minmax(0, 1fr))` }} role="grid" aria-label="Commandes par jour de la semaine et par heure">
          <span />
          {hours.map((h) => <span key={h} className="pb-1 text-center font-mono text-[10.5px] text-muted-foreground">{h}</span>)}
          {DAYS.map((d, i) => (
            <React.Fragment key={d}>
              <span className="flex items-center text-xs text-muted-foreground">{d}</span>
              {hours.map((h) => {
                const n = at(i + 1, h);
                const pct = max > 0 ? Math.round((n / max) * 82) : 0;
                return (
                  <button
                    key={h} type="button" role="gridcell" aria-label={label(i + 1, h, n)}
                    onMouseEnter={() => setFocus({ weekday: i + 1, hour: h, orders: n })} onFocus={() => setFocus({ weekday: i + 1, hour: h, orders: n })} onMouseLeave={() => setFocus(null)} onBlur={() => setFocus(null)}
                    className="aspect-square min-h-6 rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ background: n ? `color-mix(in oklab, var(--chart-1) ${18 + pct}%, var(--card))` : "var(--muted)" }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-[11.5px] text-muted-foreground" aria-hidden>
        <span>0</span>
        <span className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--chart-1) 18%, var(--card)), var(--chart-1))" }} />
        <span className="font-mono tabular-nums">{max}</span> commandes par case
      </div>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2 text-[12.5px] text-muted-foreground sm:px-6">
      {items.map((i) => <li key={i.label} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[2px]" style={{ background: i.color }} aria-hidden />{i.label}</li>)}
    </ul>
  );
}
