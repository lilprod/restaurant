import { Navigate } from "react-router-dom";
import { useSpacePath } from "@/providers/space";
import { TenantDashboardPage } from "../dashboard-page";
import { useTenant } from "../hooks";
import { WaiterHome } from "./waiter-home";

/** Accueil selon le rôle : tableau de bord (responsables), « Mon service » (serveurs), écran cuisine (cuisine). */
export function TenantHomePage() {
  const t = useTenant();
  const to = useSpacePath();
  if (t.role === "KITCHEN") return <Navigate to={to("/cuisine")} replace />;
  if (t.isManager) return <TenantDashboardPage />;
  return <WaiterHome />;
}
