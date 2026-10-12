import { useQuery } from "@tanstack/react-query";
import { CalendarClock, LayoutDashboard, Settings, ShieldCheck, WalletCards } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { Link, Outlet } from "react-router-dom";
import { AppShell, type NavItem } from "@/layouts/app-shell";
import { daysUntil, formatDate } from "@/lib/format";
import { TENANT_ROLE_LABEL } from "@/lib/labels";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "./hooks";

export function TenantShell() {
  const { user } = useSession();
  const to = useSpacePath();
  const t = useTenant();

  const nav: NavItem[] = React.useMemo(() => [
    { to: to("/"), label: "Accueil", icon: <LayoutDashboard />, end: true },
    { to: to("/parametres"), label: "Paramètres", icon: <Settings />, keywords: ["marque", "logo", "tva", "réservations"] },
    ...(t.isAdmin ? [{ to: to("/securite"), label: "Sécurité", icon: <ShieldCheck />, keywords: ["utilisateurs", "connexions"] }] : []),
    ...(t.canSeeLicense ? [{ to: to("/licence"), label: "Licence", icon: <WalletCards />, keywords: ["paiement", "abonnement", "flooz", "tmoney"] }] : []),
  ], [to, t.isAdmin, t.canSeeLicense]);

  return (
    <AppShell
      nav={nav}
      spaceLabel="Espace restaurant"
      roleLabel={TENANT_ROLE_LABEL[user?.role ?? ""] ?? ""}
      accountPath={to("/compte")}
      banner={<LicenseBanner />}
    >
      <Outlet />
    </AppShell>
  );
}

/** Bandeau global : licence en période de grâce (ambre) ou essai qui se termine (bleu). */
function LicenseBanner() {
  const session = useSession();
  const t = useTenant();
  const to = useSpacePath();
  const license = useQuery({ queryKey: t.key("license"), queryFn: t.api.license, enabled: t.canSeeLicense, staleTime: 60_000 });
  const status = license.data?.status ?? session.license?.status;
  const end = license.data?.currentPeriodEnd ?? session.license?.currentPeriodEnd;
  const graceEnd = license.data?.graceEndsAt;
  const days = daysUntil(end) ?? 99;

  let content: React.ReactNode = null;
  let tone: "amber" | "blue" = "amber";
  if (status === "GRACE") {
    const left = daysUntil(graceEnd);
    content = <>Votre licence a expiré le <strong className="font-mono">{formatDate(end)}</strong>. L'accès est maintenu{graceEnd ? <> jusqu'au <strong className="font-mono">{formatDate(graceEnd)}</strong>{left !== null && left >= 0 ? ` (${left} j)` : ""}</> : " pendant la période de grâce"} : renouvelez pour éviter la suspension.</>;
  } else if (status === "TRIALING" && days <= 3) {
    tone = "blue";
    content = <>Votre essai gratuit se termine {days <= 0 ? "aujourd'hui" : `dans ${days} jour${days > 1 ? "s" : ""}`} ({formatDate(end)}).</>;
  }
  if (!content) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      role="status"
      className={tone === "amber"
        ? "no-print flex flex-col gap-2 border-b border-[color-mix(in_oklab,var(--tone-amber-dot)_35%,var(--border))] bg-[var(--tone-amber-bg)] px-4 py-2.5 text-[13px] text-[var(--tone-amber-fg)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10"
        : "no-print flex flex-col gap-2 border-b border-[color-mix(in_oklab,var(--tone-blue-dot)_30%,var(--border))] bg-[var(--tone-blue-bg)] px-4 py-2.5 text-[13px] text-[var(--tone-blue-fg)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10"}
    >
      <span className="flex items-start gap-2"><CalendarClock className="mt-0.5 size-4 shrink-0" /><span>{content}</span></span>
      {t.canSeeLicense ? (
        <Link to={to("/licence")} className="inline-flex min-h-11 shrink-0 items-center font-medium underline underline-offset-4 sm:min-h-0">Voir comment payer</Link>
      ) : <span className="shrink-0 font-medium">Prévenez votre responsable.</span>}
    </motion.div>
  );
}
