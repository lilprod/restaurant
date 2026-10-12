import { LogOut } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { isPasswordValid, PasswordChecklist } from "@/components/password-checklist";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { AuthCard, AuthLayout } from "@/layouts/auth-layout";
import { errorMessage } from "@/lib/errors";
import { DEFAULT_POLICY_BY_SPACE } from "@/lib/policy";
import { useSession } from "@/providers/session";
import { TwoFactorSetupFlow } from "./two-factor-setup";

function LogoutLink() {
  const session = useSession();
  return (
    <button type="button" onClick={() => void session.logout()} className="inline-flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground sm:min-h-0">
      <LogOut className="size-3.5" /> Se déconnecter
    </button>
  );
}

/** Session restreinte « pwd-change » : mot de passe temporaire ou expiré à remplacer avant tout. */
export function ForcePasswordChange() {
  const session = useSession();
  const user = session.user;
  const policy = DEFAULT_POLICY_BY_SPACE[session.space];
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ctx = { email: user?.email, names: [user?.firstName ?? "", user?.lastName ?? ""].filter(Boolean) };
  const valid = isPasswordValid(next, policy, ctx) && next === confirm && current.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await session.account.changePassword({ currentPassword: current, newPassword: next });
      if (r.reloginRequired) {
        await session.logout({ silent: true });
        toast.success("Mot de passe changé", { description: "Reconnectez-vous avec votre nouveau mot de passe." });
      } else {
        session.setRestriction(null);
        await session.reloadProfile();
        toast.success("Mot de passe changé");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <AuthLayout footer={<LogoutLink />}>
      <AuthCard title="Choisissez votre mot de passe" description={<>Bonjour {user?.firstName}, votre mot de passe actuel est temporaire ou a expiré. Remplacez-le pour accéder à votre espace.</>}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <Callout tone="danger">{error}</Callout>}
          <Field label="Mot de passe actuel (temporaire)">
            <PasswordInput autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="Nouveau mot de passe">
            <PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <PasswordChecklist password={next} policy={policy} {...ctx} />
          <Field label="Confirmation" error={confirm && confirm !== next ? "Les mots de passe ne correspondent pas" : undefined}>
            <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!valid}>Mettre à jour et continuer</Button>
        </form>
      </AuthCard>
    </AuthLayout>
  );
}

/** Session restreinte « 2fa-setup » : la politique impose la 2FA pour ce rôle. */
export function ForceTwoFactorSetup() {
  const session = useSession();
  return (
    <AuthLayout wide footer={<LogoutLink />}>
      <AuthCard title="Activez la double authentification" description="Votre organisation l'exige pour votre rôle. Cela prend moins d'une minute.">
        <TwoFactorSetupFlow
          onDone={async () => {
            session.setRestriction(null);
            await session.reloadProfile().catch(() => undefined);
            toast.success("Double authentification activée");
          }}
        />
      </AuthCard>
    </AuthLayout>
  );
}
