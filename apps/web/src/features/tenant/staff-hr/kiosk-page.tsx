import type { KioskPerson, PunchAction } from "@restaurant/api-client";
import { ApiError } from "@restaurant/api-client";
import { presenceTone } from "@restaurant/ui-tokens";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Coffee, Delete, LogIn, LogOut } from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { PRESENCE_LABEL, PUNCH_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { hoursLabel, useMyAttendance } from "./hr-hooks";
import { ModuleLocked } from "./module-locked";

const actionsFor = (state: KioskPerson["state"]): { action: PunchAction; icon: React.ReactNode; primary?: boolean }[] =>
  state === "OFF" ? [{ action: "IN", icon: <LogIn />, primary: true }]
    : state === "CLOCKED_IN" ? [{ action: "BREAK_START", icon: <Coffee /> }, { action: "OUT", icon: <LogOut />, primary: true }]
      : [{ action: "BREAK_END", icon: <Coffee />, primary: true }, { action: "OUT", icon: <LogOut /> }];

/** Pointage sur tablette commune : on choisit son nom, l'action, puis on tape son code personnel (4 à 6 chiffres). Plein écran, tactile. */
export function KioskPage() {
  const t = useTenant();
  const to = useSpacePath();
  const qc = useQueryClient();
  const probe = useMyAttendance();
  const people = useQuery({ queryKey: tenantKeys.hrKiosk(t.root), queryFn: () => t.api.staffHr.kiosk(), refetchInterval: 30_000, enabled: probe.moduleEnabled });
  const [who, setWho] = React.useState<KioskPerson | null>(null);
  const [action, setAction] = React.useState<PunchAction | null>(null);
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<{ message: string; locked: boolean } | null>(null);
  const [done, setDone] = React.useState<{ name: string; action: PunchAction; worked: number } | null>(null);
  const [clock, setClock] = React.useState(() => new Date());
  React.useEffect(() => { const i = setInterval(() => setClock(new Date()), 15_000); return () => clearInterval(i); }, []);

  const reset = React.useCallback(() => { setWho(null); setAction(null); setCode(""); setError(null); }, []);
  React.useEffect(() => { if (!done) return; const i = setTimeout(() => { setDone(null); reset(); }, 3500); return () => clearTimeout(i); }, [done, reset]);

  const punch = useMutation({
    mutationFn: () => t.api.staffHr.kioskPunch({ staffId: who!.staffId, code, action: action! }),
    onSuccess: (r) => { setDone({ name: r.name, action: action!, worked: r.workedMinutes }); void qc.invalidateQueries({ queryKey: tenantKeys.hrKiosk(t.root) }); },
    onError: (e) => {
      setCode("");
      setError({ message: errorMessage(e), locked: e instanceof ApiError && e.status === 423 });
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: tenantKeys.hrKiosk(t.root) });
    },
  });

  const press = React.useCallback((d: string) => { setError(null); setCode((c) => (c.length < 6 ? c + d : c)); }, []);
  React.useEffect(() => {
    if (!who || !action || done) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setCode((c) => c.slice(0, -1));
      else if (e.key === "Enter" && code.length >= 4 && !punch.isPending) punch.mutate();
      else if (e.key === "Escape") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [who, action, done, code, punch, press, reset]);

  const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(clock);
  const date = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(clock);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-8">
        <Button asChild variant="ghost" size="lg"><Link to={to(t.isManager ? "/personnel?onglet=pointages" : "/")}><ArrowLeft /> Quitter le mode tablette</Link></Button>
        <div className="text-right leading-tight"><p className="font-mono text-3xl font-semibold tabular-nums sm:text-4xl">{time}</p><p className="text-sm text-muted-foreground first-letter:uppercase">{date}</p></div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-5 py-6 sm:px-8">
        {!probe.moduleEnabled ? <ModuleLocked /> : done ? (
          <div role="status" className="m-auto flex flex-col items-center gap-3 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)] [&_svg]:size-9">{done.action === "OUT" ? <LogOut /> : done.action.startsWith("BREAK") ? <Coffee /> : <LogIn />}</div>
            <p className="text-3xl font-semibold tracking-tight">{PUNCH_LABEL[done.action]} enregistrée</p>
            <p className="text-lg text-muted-foreground">{done.name}{done.action === "OUT" ? ` · ${hoursLabel(done.worked)} travaillées` : ""}</p>
          </div>
        ) : !who ? (
          <>
            <div><h1 className="text-2xl font-semibold tracking-tight">Qui pointe ?</h1><p className="text-muted-foreground">Touchez votre nom, puis saisissez votre code personnel.</p></div>
            {people.isError ? <ErrorState error={people.error} onRetry={() => void people.refetch()} /> : people.isLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
            ) : !people.data?.length ? (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">Aucun code de pointage défini. Un responsable peut en créer depuis Personnel › Fiches.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {people.data.map((p) => (
                  <li key={p.staffId}>
                    <button type="button" onClick={() => setWho(p)} className="flex min-h-24 w-full flex-col items-start justify-between gap-2 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]">
                      <span className="text-lg font-semibold leading-tight">{p.name}</span>
                      <span className="flex w-full items-center justify-between gap-2"><span className="truncate text-sm text-muted-foreground">{p.position}</span><Badge tone={presenceTone(p.state)} dot>{PRESENCE_LABEL[p.state]}</Badge></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : !action ? (
          <div className="mx-auto flex w-full max-w-md flex-col gap-4">
            <div><h1 className="text-2xl font-semibold tracking-tight">{who.name}</h1><p className="text-muted-foreground">{PRESENCE_LABEL[who.state]} · que souhaitez-vous faire ?</p></div>
            {actionsFor(who.state).map((a) => (
              <Button key={a.action} variant={a.primary ? "primary" : "secondary"} className="h-16 text-lg [&_svg]:size-6" onClick={() => setAction(a.action)}>{a.icon}{PUNCH_LABEL[a.action]}</Button>
            ))}
            <Button variant="ghost" size="lg" onClick={reset}>Ce n'est pas moi</Button>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <div><h1 className="text-2xl font-semibold tracking-tight">{who.name}</h1><p className="text-muted-foreground">{PUNCH_LABEL[action]} · saisissez votre code</p></div>
            <div role="group" aria-label="Code saisi" className="flex h-14 items-center justify-center gap-3 rounded-xl border border-border bg-card" aria-live="polite">
              {Array.from({ length: Math.max(4, code.length) }, (_, i) => <span key={i} className={cn("size-3.5 rounded-full border-2", i < code.length ? "border-foreground bg-foreground" : "border-border-strong")} />)}
              <span className="sr-only">{code.length} chiffre{code.length > 1 ? "s" : ""} saisi{code.length > 1 ? "s" : ""}</span>
            </div>
            {error && <p role="alert" className={cn("rounded-lg border px-3 py-2 text-sm", error.locked ? "border-[var(--tone-red-dot)] bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]" : "border-[var(--tone-amber-dot)] bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]")}>{error.message}</p>}
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <Key key={d} onClick={() => press(d)}>{d}</Key>)}
              <Key onClick={reset} aria-label="Annuler" className="font-sans text-base font-medium">Annuler</Key>
              <Key onClick={() => press("0")}>0</Key>
              <Key onClick={() => setCode((c) => c.slice(0, -1))} aria-label="Effacer le dernier chiffre"><Delete className="size-6" /></Key>
            </div>
            <Button variant="primary" className="h-16 text-lg" disabled={code.length < 4 || !!error?.locked} loading={punch.isPending} onClick={() => punch.mutate()}>Valider</Button>
          </div>
        )}
      </main>
    </div>
  );
}

function Key({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={cn("flex h-16 items-center justify-center rounded-xl border border-border bg-card font-mono text-2xl font-semibold tabular-nums shadow-sm transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] active:bg-muted", className)}>{children}</button>;
}
