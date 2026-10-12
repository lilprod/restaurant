import { Compass, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AuthCard, AuthLayout } from "@/layouts/auth-layout";
import { BrandingProvider } from "@/providers/branding";
import { useSpacePath } from "@/providers/space";

export function NotFoundPage({ inShell }: { inShell?: boolean }) {
  if (inShell) return <ShellNotFound />;
  return (
    <BrandingProvider>
      <AuthLayout>
        <AuthCard title="Page introuvable" description="Le lien est peut-être erroné ou la page a été déplacée.">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild variant="primary" className="flex-1"><Link to="/admin">Administration</Link></Button>
            <Button asChild variant="secondary" className="flex-1"><Link to="/inscription">Inscrire un restaurant</Link></Button>
          </div>
        </AuthCard>
      </AuthLayout>
    </BrandingProvider>
  );
}

function ShellNotFound() {
  const to = useSpacePath();
  return (
    <EmptyState
      icon={<Compass />}
      title="Page introuvable"
      description="Cette page n'existe pas ou vous n'y avez pas accès."
      action={<Button asChild variant="secondary"><Link to={to("/")}>Retour à l'accueil</Link></Button>}
      className="py-24"
    />
  );
}

export function TenantNotFound() {
  return (
    <BrandingProvider>
      <AuthLayout>
        <AuthCard title="Restaurant introuvable" description="Aucun restaurant actif ne correspond à cette adresse.">
          <div className="flex flex-col items-center gap-5 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-border bg-subtle"><Store className="size-5 text-muted-foreground" /></span>
            <p className="text-sm text-muted-foreground">Vérifiez l'adresse communiquée par votre restaurant. Si votre inscription est récente, elle est peut-être encore en cours de validation.</p>
            <Button asChild variant="secondary" className="w-full"><Link to="/inscription">Inscrire un restaurant</Link></Button>
          </div>
        </AuthCard>
      </AuthLayout>
    </BrandingProvider>
  );
}
