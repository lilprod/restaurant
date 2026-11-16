import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError, isTwoFactorChallenge } from "@restaurant/api-client";
import { customerSignupSchema, tenantLoginSchema } from "@restaurant/validation";
import { LockKeyhole, UserPlus } from "lucide-react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import type { z } from "zod";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { applyApiErrors, errorMessage } from "@/lib/errors";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { publicSpace } from "@/app/spaces";

type LoginValues = z.infer<typeof tenantLoginSchema>;

/** Connexion du client (même route que le personnel : le rôle CUSTOMER mène à l'espace client). */
export function LoginForm({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const to = useSpacePath();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<LoginValues>({ resolver: zodResolver(tenantLoginSchema), defaultValues: { email: "", password: "", tenantSlug: session.slug } });
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const res = await session.auth.login({ email: v.email, password: v.password, tenantSlug: session.slug });
      if (isTwoFactorChallenge(res)) { setError("La double authentification n'est pas disponible pour les comptes clients."); return; }
      await session.completeLogin(res);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.isLocked) setError(`Trop de tentatives. Réessayez dans ${e.lockedMinutes ?? 15} minutes.`);
      else setError(errorMessage(e));
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error && <Callout tone="danger" title={error} />}
      <Field label="Email" error={form.formState.errors.email && "Adresse email invalide"}>
        <Input type="email" autoComplete="username" inputMode="email" placeholder="vous@exemple.com" {...form.register("email")} />
      </Field>
      <Field label="Mot de passe" error={form.formState.errors.password && "Saisissez votre mot de passe"}
        aside={<Link to={to("/mot-de-passe-oublie")} className="rounded text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Mot de passe oublié ?</Link>}>
        <PasswordInput autoComplete="current-password" {...form.register("password")} />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}><LockKeyhole /> Se connecter</Button>
    </form>
  );
}

type SignupValues = z.input<typeof customerSignupSchema>;

/** Création de compte : coordonnées, mot de passe, consentement ; connexion automatique ensuite. */
export function SignupForm({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<SignupValues>({
    resolver: zodResolver(customerSignupSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", password: "", consent: undefined as unknown as true },
  });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const body = customerSignupSchema.parse(v);
      await publicSpace.signup(session.slug!, body);
      const res = await session.auth.login({ email: body.email, password: body.password, tenantSlug: session.slug });
      if (isTwoFactorChallenge(res)) return;
      await session.completeLogin(res);
      onDone();
    } catch (err) {
      if (!applyApiErrors(err, form.setError, { password: "password" })) setError(errorMessage(err));
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {error && <Callout tone="danger" title={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom" error={e.firstName?.message}><Input autoComplete="given-name" {...form.register("firstName")} /></Field>
        <Field label="Nom" error={e.lastName?.message}><Input autoComplete="family-name" {...form.register("lastName")} /></Field>
      </div>
      <Field label="Email" error={e.email && "Adresse email invalide"}><Input type="email" autoComplete="email" inputMode="email" {...form.register("email")} /></Field>
      <Field label="Téléphone" hint="Facultatif. Pour les SMS « commande prête »." error={e.phone?.message}>
        <Input type="tel" autoComplete="tel" inputMode="tel" placeholder="90 11 22 33" {...form.register("phone")} />
      </Field>
      <Field label="Mot de passe" hint="8 caractères minimum, avec une majuscule, une minuscule et un chiffre." error={e.password?.message}>
        <PasswordInput autoComplete="new-password" {...form.register("password")} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded border-input accent-brand" aria-invalid={!!e.consent} {...form.register("consent")} />
          <span>J'accepte que le restaurant conserve mes coordonnées pour gérer mes réservations, mes commandes et mes avis. Je peux exporter ou supprimer mes données à tout moment.</span>
        </label>
        {e.consent && <p role="alert" className="text-[12.5px] text-danger">{e.consent.message}</p>}
      </div>
      <Button type="submit" variant="primary" size="lg" loading={form.formState.isSubmitting}><UserPlus /> Créer mon compte</Button>
    </form>
  );
}
