import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError, isTwoFactorChallenge, type LoginSuccess } from "@restaurant/api-client";
import { loginSchema } from "@restaurant/validation";
import { ArrowLeft, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { z } from "zod";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import { AuthCard, AuthLayout } from "@/layouts/auth-layout";
import { errorMessage } from "@/lib/errors";
import { useBranding } from "@/providers/branding";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { LicenseBlockedScreen } from "./license-blocked";

type Values = z.infer<typeof loginSchema>;

/** Connexion (plateforme ou restaurant), suivie si besoin de l'étape de double authentification. */
export function LoginPage() {
  const session = useSession();
  const { branding } = useBranding();
  const to = useSpacePath();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  const [challenge, setChallenge] = React.useState<{ token: string; email: string } | null>(null);
  const [locked, setLocked] = React.useState<number | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);

  const form = useForm<Values>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });

  if (session.status === "authenticated") return <Navigate to={from ?? to("/")} replace />;
  if (session.blocked) return <LicenseBlockedScreen error={session.blocked} />;

  async function finish(res: LoginSuccess) {
    await session.completeLogin(res);
    navigate(from ?? to("/"), { replace: true });
  }

  function handleError(e: unknown) {
    if (e instanceof ApiError) {
      if (e.isLocked) { setLocked(e.lockedMinutes ?? 15); setFormError(null); return; }
      if (e.isLicenseBlocked) { session.setBlocked(e); return; }
    }
    setFormError(errorMessage(e));
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setLocked(null);
    try {
      const res = await session.auth.login({ ...values, ...(session.slug ? { tenantSlug: session.slug } : {}) });
      if (isTwoFactorChallenge(res)) setChallenge({ token: res.challengeToken, email: values.email });
      else await finish(res);
    } catch (e) {
      handleError(e);
    }
  });

  const spaceLabel = session.space === "platform" ? "Administration de la plateforme" : branding?.displayName ?? "Espace restaurant";

  return (
    <AuthLayout
      footer={session.space === "tenant" ? <span>Propulsé par Gestion Restaurant</span> : <span>Accès réservé à l'équipe de la plateforme</span>}
    >
      <AnimatePresence mode="wait" initial={false}>
        {challenge ? (
          <motion.div key="2fa" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
            <TwoFactorStep
              challengeToken={challenge.token}
              email={challenge.email}
              onBack={() => setChallenge(null)}
              onSuccess={finish}
              onError={(e) => {
                if (e instanceof ApiError && (e.isLocked || e.isLicenseBlocked)) { setChallenge(null); handleError(e); return true; }
                if (e instanceof ApiError && e.status === 401 && /expirée/.test(e.message)) { setChallenge(null); setFormError(e.message); return true; }
                return false;
              }}
            />
          </motion.div>
        ) : (
          <motion.div key="login" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2 }}>
            <AuthCard title="Connexion" description={spaceLabel}>
              <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
                <AnimatePresence initial={false}>
                  {locked !== null && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                      <Callout tone="danger" title="Compte temporairement verrouillé">
                        Trop de tentatives incorrectes. Réessayez dans <strong className="tabular">{locked} minute{locked > 1 ? "s" : ""}</strong>,
                        ou réinitialisez votre mot de passe.
                      </Callout>
                    </motion.div>
                  )}
                  {formError && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                      <Callout tone="danger">{formError}</Callout>
                    </motion.div>
                  )}
                </AnimatePresence>
                <Field label="Email" error={form.formState.errors.email && "Adresse email invalide"}>
                  <Input type="email" autoComplete="username" inputMode="email" autoFocus placeholder="vous@exemple.com" {...form.register("email")} />
                </Field>
                <Field
                  label="Mot de passe"
                  error={form.formState.errors.password && "Saisissez votre mot de passe"}
                  aside={<Link to={to("/mot-de-passe-oublie")} className="rounded text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Mot de passe oublié ?</Link>}
                >
                  <PasswordInput autoComplete="current-password" {...form.register("password")} />
                </Field>
                <Button type="submit" variant="primary" size="lg" className="mt-1 w-full" loading={form.formState.isSubmitting}>
                  <LockKeyhole /> Se connecter
                </Button>
              </form>
            </AuthCard>
          </motion.div>
        )}
      </AnimatePresence>
      {session.space === "tenant" && !challenge && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Nouveau restaurant ? <Link to="/inscription" className="font-medium text-foreground underline-offset-4 hover:underline">Créer un compte</Link>
        </p>
      )}
    </AuthLayout>
  );
}

/** Étape 2FA : code à 6 chiffres (soumission automatique) ou code de secours. */
function TwoFactorStep({ challengeToken, email, onBack, onSuccess, onError }: {
  challengeToken: string; email: string; onBack: () => void; onSuccess: (r: LoginSuccess) => Promise<void>; onError: (e: unknown) => boolean;
}) {
  const { auth } = useSession();
  const [recovery, setRecovery] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function verify(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSuccess(await auth.verify2fa({ challengeToken, code: value }));
    } catch (e) {
      if (!onError(e)) { setError(errorMessage(e)); setCode(""); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Vérification en deux étapes"
      description={recovery ? "Saisissez l'un de vos codes de secours (format XXXXX-XXXXX)." : <>Entrez le code à 6 chiffres affiché par votre application d'authentification pour <span className="font-medium text-foreground">{email}</span>.</>}
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void verify(code); }}>
        <div className="flex justify-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-border bg-subtle">
            {recovery ? <KeyRound className="size-5 text-muted-foreground" /> : <ShieldCheck className="size-5 text-brand-ink" />}
          </div>
        </div>
        {recovery ? (
          <Field label="Code de secours" error={error ?? undefined}>
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A1B2C-3D4E5"
              autoComplete="off"
              spellCheck={false}
              className="text-center font-mono tracking-widest"
            />
          </Field>
        ) : (
          <div className="flex flex-col gap-2">
            <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => void verify(v)} autoFocus disabled={busy} invalid={!!error} />
            <AnimatePresence>
              {error && <motion.p role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center text-[13px] text-danger">{error}</motion.p>}
            </AnimatePresence>
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={recovery ? code.trim().length < 10 : code.length !== 6}>
          Vérifier
        </Button>
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0">
            <ArrowLeft className="size-3.5" /> Retour
          </button>
          <button
            type="button"
            onClick={() => { setRecovery((r) => !r); setCode(""); setError(null); }}
            className="min-h-11 rounded font-medium text-brand-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
          >
            {recovery ? "Utiliser l'application" : "Utiliser un code de secours"}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
