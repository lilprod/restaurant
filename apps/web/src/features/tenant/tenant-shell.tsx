import { useQuery } from "@tanstack/react-query";
import {
  BookOpen, CalendarClock, ChefHat, ClipboardList, HandPlatter, Landmark, LayoutDashboard, LayoutGrid, Settings, ShieldCheck,
  ShoppingBag, SquarePlus, Users, WalletCards,
} from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import type { CommandEntry } from "@/components/command-palette";
import { AppShell, type NavItem } from "@/layouts/app-shell";
import { daysUntil, formatDate } from "@/lib/format";
import { TENANT_ROLE_LABEL } from "@/lib/labels";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "./hooks";

/**
 * Navigation selon le rôle (voir le tableau des rôles de docs/API.md) :
 * - salle (ADMIN, MANAGER, WAITER) : prise de commande, commandes, tables, caisse ;
 * - cuisine (ADMIN, MANAGER, KITCHEN) : écran cuisine ; la cuisine gère aussi la disponibilité des plats ;
 * - responsables (ADMIN, MANAGER) : tableau de bord, menu, équipe, licence ; ADMIN seul : sécurité.
 */
export function useTenantNav(): NavItem[] {
  const to = useSpacePath();
  const t = useTenant();
  return React.useMemo(() => {
    const S = "Service", G = "Gestion";
    const items: (NavItem | false)[] = [
      t.role !== "KITCHEN" && { to: to("/"), label: t.isManager ? "Tableau de bord" : "Mon service", icon: t.isManager ? <LayoutDashboard /> : <HandPlatter />, end: true, section: S },
      t.isFloor && { to: to("/commandes/nouvelle"), label: "Nouvelle commande", icon: <SquarePlus />, keywords: ["prise de commande", "caisse", "pos"], section: S },
      { to: to("/commandes"), label: "Commandes", icon: <ClipboardList />, keywords: ["addition", "encaisser", "ticket"], section: S },
      t.isFloor && { to: to("/tables"), label: "Tables", icon: <LayoutGrid />, keywords: ["salle", "débarrasser"], section: S },
      t.isKitchen && { to: to("/cuisine"), label: "Écran cuisine", icon: <ChefHat />, keywords: ["kds", "préparation"], section: S },
      t.isFloor && { to: to("/caisse"), label: "Caisse", icon: <Landmark />, keywords: ["fond de caisse", "clôture", "espèces"], section: S },
      (t.isManager || t.role === "KITCHEN") && { to: to("/menu"), label: t.isManager ? "Menu" : "Disponibilités", icon: <BookOpen />, keywords: ["carte", "plats", "épuisé", "allergènes"], section: G },
      t.isManager && { to: to("/equipe"), label: "Équipe", icon: <Users />, keywords: ["personnel", "serveur", "rôle"], section: G },
      { to: to("/parametres"), label: "Paramètres", icon: <Settings />, keywords: ["marque", "logo", "tva", "réservations"], section: G },
      t.isAdmin && { to: to("/securite"), label: "Sécurité", icon: <ShieldCheck />, keywords: ["utilisateurs", "connexions"], section: G },
      t.canSeeLicense && { to: to("/licence"), label: "Licence", icon: <WalletCards />, keywords: ["paiement", "abonnement", "flooz", "tmoney"], section: G },
    ];
    return items.filter(Boolean) as NavItem[];
  }, [to, t.role, t.isManager, t.isFloor, t.isKitchen, t.isAdmin, t.canSeeLicense]);
}

export function TenantShell() {
  const { user } = useSession();
  const to = useSpacePath();
  const t = useTenant();
  const navigate = useNavigate();
  const nav = useTenantNav();

  const actions: CommandEntry[] = React.useMemo(() => [
    ...(t.isFloor ? [
      { id: "new-order", label: "Nouvelle commande sur place", icon: <SquarePlus />, keywords: ["table"], run: () => navigate(to("/commandes/nouvelle")) },
      { id: "new-takeaway", label: "Nouvelle commande à emporter", icon: <ShoppingBag />, keywords: ["emporter"], run: () => navigate(to("/commandes/nouvelle?type=TAKEAWAY")) },
    ] : []),
    ...(t.isKitchen ? [{ id: "kds", label: "Ouvrir l'écran cuisine", icon: <ChefHat />, run: () => navigate(to("/cuisine")) }] : []),
  ], [t.isFloor, t.isKitchen, navigate, to]);

  return (
    <AppShell
      nav={nav}
      actions={actions}
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
