import type { ApiError } from "@restaurant/api-client";
import { Banknote, CreditCard, Globe, Mail, Phone, RefreshCw, ShieldOff, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-button";
import { AuthCard, AuthLayout } from "@/layouts/auth-layout";
import { usePlatformBranding, useBranding } from "@/providers/branding";
import { useSession } from "@/providers/session";

/**
 * Écran « licence expirée / accès suspendu » (403 LICENSE_BLOCKED).
 * Les numéros de paiement ne sont exposés qu'aux sessions valides (GET /tenant/license) : ici, on affiche
 * les moyens acceptés et les contacts publics du support (GET /public/branding).
 */
export function LicenseBlockedScreen({ error }: { error: ApiError }) {
  const { branding } = useBranding();
  const platform = usePlatformBranding().data;
  const session = useSession();
  const support = platform?.support;
  const suspended = /suspendu/i.test(error.message);

  return (
    <AuthLayout wide>
      <AuthCard
        title={suspended ? "Accès suspendu" : "Licence expirée"}
        description={error.message}
      >
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-subtle p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]">
              <ShieldOff className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">
              Les données de <span className="font-medium text-foreground">{branding?.displayName ?? "votre restaurant"}</span> sont conservées.
              L'accès sera rétabli dès l'enregistrement de votre paiement.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">Comment régulariser</h2>
            <ul className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
              {[
                { Icon: Smartphone, label: "Flooz" },
                { Icon: Smartphone, label: "TMoney" },
                { Icon: CreditCard, label: "Carte / virement" },
                { Icon: Banknote, label: "Espèces" },
              ].map(({ Icon, label }) => (
                <li key={label} className="flex items-center gap-2 rounded-md border border-border px-3 py-2.5">
                  <Icon className="size-4 text-muted-foreground" /> {label}
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">
              Contactez notre équipe pour obtenir les coordonnées de paiement et la référence à indiquer. Votre licence est prolongée dès réception.
            </p>
          </div>

          {(support?.email || support?.phone || support?.website) ? (
            <div className="flex flex-col gap-2">
              {support.phone && <ContactRow icon={<Phone className="size-4" />} value={support.phone} />}
              {support.email && <ContactRow icon={<Mail className="size-4" />} value={support.email} />}
              {support.website && <ContactRow icon={<Globe className="size-4" />} value={support.website} />}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Contactez l'éditeur de la plateforme pour renouveler votre licence.</p>
          )}

          <Button
            variant="secondary"
            className="w-full"
            onClick={() => { session.setBlocked(null); void session.logout({ silent: true }); }}
          >
            <RefreshCw /> Réessayer la connexion
          </Button>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}

function ContactRow({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <CopyField value={value} className="flex-1" mono={false} />
    </div>
  );
}
