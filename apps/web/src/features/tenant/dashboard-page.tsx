import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, BarChart3, CalendarDays, Check, ChefHat, ClipboardList, Package, Palette, ShieldCheck, Sparkles, Store, Users, WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { ProgressRing } from "@/components/ui/progress-ring";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/cn";
import { daysUntil, formatDate } from "@/lib/format";
import { SUBSCRIPTION_STATUS_LABEL, TENANT_ROLE_LABEL } from "@/lib/labels";
import { useBranding } from "@/providers/branding";
import { useUser } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "./hooks";

const MODULES = [
  { icon: ClipboardList, title: "Commandes", text: "Prise de commande en salle, à emporter et addition.", phase: 1 },
  { icon: ChefHat, title: "Écran cuisine", text: "Tickets en temps réel, temps de préparation.", phase: 1 },
  { icon: CalendarDays, title: "Réservations", text: "Plan de salle, créneaux et liste d'attente.", phase: 2 },
  { icon: Package, title: "Stock", text: "Ingrédients, fiches techniques et fournisseurs.", phase: 3 },
  { icon: Users, title: "Personnel", text: "Comptes de l'équipe, plannings et pointage.", phase: 4 },
  { icon: BarChart3, title: "Rapports", text: "Chiffre d'affaires, plats populaires, exports.", phase: 5 },
];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("fr-FR", { hour: "numeric", hour12: false, timeZone: "Africa/Lome" }).format(new Date()));
  return h < 5 || h >= 18 ? "Bonsoir" : "Bonjour";
}

export function TenantDashboardPage() {
  const user = useUser();
  const t = useTenant();
  const to = useSpacePath();
  const { branding } = useBranding();
  const canSettings = t.role === "ADMIN" || t.role === "MANAGER";
  const settings = useQuery({ queryKey: t.key("settings", "all"), queryFn: t.api.settings.all, enabled: canSettings });
  const license = useQuery({ queryKey: t.key("license"), queryFn: t.api.license, enabled: t.canSeeLicense, staleTime: 60_000 });

  const b = settings.data?.business;
  const steps = [
    { done: !!(b?.taxId && b?.address?.city), label: "Compléter les informations légales", hint: "NIF, RCCM et adresse apparaissent sur vos reçus.", to: to("/parametres?onglet=informations"), icon: Store, show: canSettings },
    { done: !!(settings.data?.assets?.logo), label: "Personnaliser votre marque", hint: "Logo, couleurs et favicon de votre espace.", to: to("/parametres?onglet=marque"), icon: Palette, show: canSettings },
    { done: user.twoFactorEnabled, label: "Activer la double authentification", hint: "Protège votre compte même si votre mot de passe fuite.", to: to("/compte?onglet=securite"), icon: ShieldCheck, show: true },
  ].filter((s) => s.show);
  const done = steps.filter((s) => s.done).length;
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lome" }).format(new Date());

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted-foreground first-letter:uppercase">{today}</span>
        <h1 className="font-brand text-2xl font-semibold tracking-[-0.02em] sm:text-[28px]">{greeting()} {user.firstName}</h1>
        <p className="text-sm text-muted-foreground sm:text-[15px]">
          {branding?.displayName} · <span className="text-foreground">{TENANT_ROLE_LABEL[user.role] ?? user.role}</span>
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="relative overflow-hidden lg:col-span-2">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-brand opacity-[0.07] blur-3xl" />
          <div className="relative flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-brand-ink"><Sparkles className="size-3.5" /> Bien démarrer</span>
                <h2 className="text-lg font-semibold tracking-tight">Votre espace est prêt</h2>
                <p className="text-sm text-muted-foreground">Quelques réglages pour un service sans accroc.</p>
              </div>
              <ProgressRing value={steps.length ? done / steps.length : 1} size={56} stroke={5}>
                <span className="font-mono text-xs font-semibold tabular">{done}/{steps.length}</span>
              </ProgressRing>
            </div>
            <ul className="flex flex-col gap-2">
              {steps.map((s) => (
                <li key={s.label}>
                  <Link to={s.to} className={cn("group flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", s.done && "opacity-70")}>
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full border", s.done ? "border-transparent bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]" : "border-border bg-subtle text-muted-foreground")}>
                      {s.done ? <Check className="size-4" /> : <s.icon className="size-4" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={cn("text-sm font-medium", s.done && "line-through decoration-1")}>{s.label}</span>
                      <span className="truncate text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                    <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        {t.canSeeLicense ? (
          <Card className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Licence</span>
              <WalletCards className="size-4 text-muted-foreground" />
            </div>
            {license.isLoading ? <Skeleton className="h-24" /> : license.data && (
              <>
                <div className="flex items-baseline gap-2">
                  <span className={cn("font-mono text-4xl font-semibold tracking-tight tabular", license.data.status === "GRACE" && "text-warning")}>
                    {Math.max(0, license.data.status === "GRACE" ? daysUntil(license.data.graceEndsAt) ?? 0 : license.data.daysLeft ?? 0)}
                  </span>
                  <span className="text-sm text-muted-foreground">{license.data.status === "GRACE" ? "jours de grâce restants" : "jours restants"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <StatusBadge status={license.data.status} labels={SUBSCRIPTION_STATUS_LABEL} />
                  <span className="text-muted-foreground">Plan {license.data.plan?.name} · jusqu'au <span className="font-mono">{formatDate(license.data.currentPeriodEnd)}</span></span>
                </div>
                <Link to={to("/licence")} className="mt-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-ink hover:underline sm:min-h-0">Détails et paiement <ArrowRight className="size-3.5" /></Link>
              </>
            )}
          </Card>
        ) : (
          <Card className="flex flex-col gap-3 p-5 sm:p-6">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Votre compte</span>
            <p className="text-sm text-muted-foreground">Les écrans de service (commandes, cuisine) arrivent bientôt. En attendant, sécurisez votre compte.</p>
            <Link to={to("/compte")} className="mt-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-ink hover:underline sm:min-h-0">Mon compte <ArrowRight className="size-3.5" /></Link>
          </Card>
        )}
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-tight">Bientôt : commandes, cuisine, réservations…</h2>
            <p className="text-sm text-muted-foreground">Les modules arrivent progressivement, sans rien installer.</p>
          </div>
        </div>
        <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((m) => (
            <StaggerItem key={m.title}>
              <div className="flex h-full items-start gap-3 rounded-lg border border-dashed border-border-strong bg-subtle p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-xs"><m.icon className="size-4" /></span>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{m.title}</span>
                    <Badge tone="outline" className="h-5 text-[11px]">Phase {m.phase}</Badge>
                  </div>
                  <p className="text-[13px] text-muted-foreground">{m.text}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>
    </div>
  );
}
