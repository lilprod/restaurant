import { CircleCheck, TriangleAlert } from "lucide-react";
import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getTenantSpace, platformSpace } from "@/app/spaces";
import { isPasswordValid, PasswordChecklist } from "@/components/password-checklist";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { AuthCard, AuthLayout } from "@/layouts/auth-layout";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_POLICY_BY_SPACE } from "@/lib/policy";
import { BrandingProvider } from "@/providers/branding";

/** Lien reçu par email : /reset-password?token=…&space=platform|tenant&tenant=slug */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const space = params.get("space") === "tenant" ? "tenant" : "platform";
  const tenant = params.get("tenant")?.toLowerCase() ?? undefined;
  return (
    <BrandingProvider slug={space === "tenant" ? tenant : undefined}>
      <ResetForm token={token} space={space} tenant={tenant} />
    </BrandingProvider>
  );
}

function ResetForm({ token, space, tenant }: { token: string; space: "platform" | "tenant"; tenant?: string }) {
  const auth = space === "tenant" && tenant ? getTenantSpace(tenant).auth : platformSpace.auth;
  const loginPath = space === "tenant" && tenant ? `/r/${tenant}/login` : "/admin/login";
  const policy = DEFAULT_POLICY_BY_SPACE[space];
  const [pwd, setPwd] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const valid = isPasswordValid(pwd, policy);
  const mismatch = confirm.length > 0 && confirm !== pwd;

  if (!token || token.length < 20 || (space === "tenant" && !tenant)) {
    return (
      <AuthLayout>
        <AuthCard title="Lien invalide" description="Ce lien de réinitialisation est incomplet ou mal copié.">
          <div className="flex flex-col gap-4">
            <Callout tone="warning" title="Que faire ?">Demandez un nouveau lien depuis la page « Mot de passe oublié ».</Callout>
            <Button asChild variant="secondary"><Link to={loginPath}>Aller à la connexion</Link></Button>
          </div>
        </AuthCard>
      </AuthLayout>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || pwd !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await auth.resetPassword({ token, newPassword: pwd });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout>
      {done ? (
        <AuthCard title="Mot de passe modifié" description="Toutes vos sessions ont été fermées par sécurité.">
          <div className="flex flex-col items-center gap-5">
            <span className="flex size-14 items-center justify-center rounded-full bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]"><CircleCheck className="size-6" /></span>
            <Button asChild variant="primary" className="w-full"><Link to={loginPath}>Se connecter</Link></Button>
          </div>
        </AuthCard>
      ) : (
        <AuthCard title="Nouveau mot de passe" description="Choisissez un mot de passe que vous n'utilisez nulle part ailleurs.">
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            {error && <Callout tone="danger" title={error}>{/expiré|invalide/i.test(error) ? "Demandez un nouveau lien depuis la page de connexion." : null}</Callout>}
            <Field label="Nouveau mot de passe">
              <PasswordInput autoComplete="new-password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </Field>
            <PasswordChecklist password={pwd} policy={policy} />
            <Field label="Confirmation" error={mismatch ? "Les mots de passe ne correspondent pas" : undefined}>
              <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!valid || pwd !== confirm}>
              Enregistrer le mot de passe
            </Button>
            {space === "tenant" && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> La politique de votre restaurant peut imposer des règles supplémentaires.
              </p>
            )}
          </form>
        </AuthCard>
      )}
    </AuthLayout>
  );
}
