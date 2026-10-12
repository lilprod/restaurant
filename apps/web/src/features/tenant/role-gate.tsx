import * as React from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";

/** Écran réservé à certains rôles (miroir des droits de l'API) : les autres reviennent à l'accueil. */
export function RoleGate({ allow, children }: { allow: string[]; children: React.ReactNode }) {
  const { user } = useSession();
  const to = useSpacePath();
  if (!user || !allow.includes(user.role)) return <Navigate to={to("/")} replace />;
  return <>{children}</>;
}
