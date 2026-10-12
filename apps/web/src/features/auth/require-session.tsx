import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { BrandMark } from "@/components/brand-mark";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { LicenseBlockedScreen } from "./license-blocked";
import { ForcePasswordChange, ForceTwoFactorSetup } from "./restricted";

export function FullScreenLoader({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4" aria-busy="true">
      <BrandMark size={36} />
      <span className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner /> {label}</span>
    </div>
  );
}

/**
 * Garde d'accès d'un espace : redirige vers la connexion, affiche l'écran de licence bloquée,
 * ou force la régularisation d'une session restreinte (mot de passe / 2FA) avant l'application.
 */
export function RequireSession({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const location = useLocation();
  const to = useSpacePath();
  if (session.blocked) return <LicenseBlockedScreen error={session.blocked} />;
  if (session.status === "loading") return <FullScreenLoader />;
  if (session.status === "anonymous") return <Navigate to={to("/login")} replace state={{ from: location.pathname + location.search }} />;
  if (session.restriction === "pwd-change") return <ForcePasswordChange />;
  if (session.restriction === "2fa-setup") return <ForceTwoFactorSetup />;
  return <>{children}</>;
}
