import { CreditCard, Inbox, Layers, LayoutDashboard, Plus, Receipt, Settings, ShieldCheck, Store, Users } from "lucide-react";
import * as React from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { AppShell, type NavItem } from "@/layouts/app-shell";
import { PLATFORM_ROLE_LABEL } from "@/lib/labels";
import { useSession } from "@/providers/session";
import { papi, useCanWrite } from "./hooks";

export function PlatformShell() {
  const { user } = useSession();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const superAdmin = user?.role === "SUPER_ADMIN";

  const nav: NavItem[] = React.useMemo(() => [
    { to: "/admin", label: "Tableau de bord", icon: <LayoutDashboard />, end: true, keywords: ["accueil", "kpi"] },
    { to: "/admin/restaurants", label: "Restaurants", icon: <Store />, keywords: ["tenants", "clients"] },
    { to: "/admin/inscriptions", label: "Inscriptions", icon: <Inbox />, keywords: ["demandes", "validation"] },
    { to: "/admin/plans", label: "Plans", icon: <Layers />, keywords: ["tarifs", "offres"] },
    { to: "/admin/paiements", label: "Paiements", icon: <CreditCard />, keywords: ["reçus", "licences", "flooz", "tmoney"] },
    { to: "/admin/parametres", label: "Paramètres", icon: <Settings />, keywords: ["marque", "logo", "société"] },
    ...(superAdmin ? [
      { to: "/admin/equipe", label: "Équipe", icon: <Users />, keywords: ["utilisateurs", "support"] },
      { to: "/admin/securite", label: "Sécurité", icon: <ShieldCheck />, keywords: ["connexions", "journal"] },
    ] : []),
  ], [superAdmin]);

  const actions = React.useMemo(() => canWrite ? [
    { id: "new-tenant", label: "Créer un restaurant", icon: <Plus />, keywords: ["nouveau"], run: () => navigate("/admin/restaurants?nouveau=1") },
    { id: "new-payment", label: "Enregistrer un paiement", icon: <Receipt />, keywords: ["encaisser", "licence"], run: () => navigate("/admin/paiements?nouveau=1") },
    { id: "new-plan", label: "Créer un plan", icon: <Layers />, run: () => navigate("/admin/plans?nouveau=1") },
  ] : [], [canWrite, navigate]);

  const searchTenants = React.useCallback(async (q: string) => {
    const r = await papi.tenants.list({ search: q, pageSize: 8 });
    return r.items.map((t) => ({ id: t.id, name: t.name, slug: t.slug, status: t.status }));
  }, []);

  return (
    <AppShell
      nav={nav}
      spaceLabel="Administration"
      roleLabel={PLATFORM_ROLE_LABEL[user?.role ?? ""] ?? ""}
      accountPath="/admin/compte"
      actions={actions}
      searchTenants={searchTenants}
      onTenant={(t) => navigate(`/admin/restaurants/${t.id}`)}
    >
      <Outlet />
    </AppShell>
  );
}
