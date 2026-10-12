import { zodResolver } from "@hookform/resolvers/zod";
import { DEFAULT_PASSWORD_POLICY } from "@restaurant/utils";
import { registrationInputSchema, type RegistrationInput } from "@restaurant/validation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleCheck, Clock, ShieldCheck, Smartphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Link } from "react-router-dom";
import { publicSpace } from "@/app/spaces";
import { BrandMark } from "@/components/brand-mark";
import { PasswordChecklist } from "@/components/password-checklist";
import { PasswordInput } from "@/components/password-input";
import { PlanPicker } from "@/components/plan-picker";
import { ThemeSwitcher } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { applyApiErrors, errorMessage } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import { BrandingProvider } from "@/providers/branding";

export function RegisterPage() {
  return (
    <BrandingProvider>
      <RegisterInner />
    </BrandingProvider>
  );
}

function RegisterInner() {
  const plans = useQuery({ queryKey: ["public", "plans"], queryFn: publicSpace.plans });
  const [cycle, setCycle] = React.useState<"MONTHLY" | "YEARLY">("MONTHLY");
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<RegistrationInput>({
    resolver: zodResolver(registrationInputSchema),
    defaultValues: { restaurantName: "", slug: "", ownerFirstName: "", ownerLastName: "", email: "", password: "" },
  });
  const { register, control, setValue, formState: { errors } } = form;
  const [name, password, email, first, last, slug] = useWatch({ control, name: ["restaurantName", "password", "email", "ownerFirstName", "ownerLastName", "slug"] });
  React.useEffect(() => { if (!slugEdited) setValue("slug", slugify(name ?? "")); }, [name, slugEdited, setValue]);
  React.useEffect(() => { if (plans.data?.[0] && !form.getValues("planId")) setValue("planId", plans.data[0].id); }, [plans.data, form, setValue]);

  const submit = useMutation({
    mutationFn: (v: RegistrationInput) => publicSpace.register({ ...v, phone: v.phone || undefined }),
    onSuccess: (r) => { setDone(r.message); window.scrollTo({ top: 0, behavior: "smooth" }); },
    onError: (e) => { applyApiErrors(e, form.setError); setError(errorMessage(e)); },
  });
  const onSubmit = form.handleSubmit((v) => { setError(null); submit.mutate(v); }, () => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus());
  });

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-60 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_0%,black,transparent)]" />
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-8 sm:py-6">
        <BrandMark showName size={28} />
        <div className="flex items-center gap-3">
          <ThemeSwitcher />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 pb-20 sm:px-8">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div key="done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-10 flex max-w-md flex-col items-center gap-5 rounded-xl border border-border bg-card p-8 text-center shadow-md">
              <motion.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 22 }} className="flex size-16 items-center justify-center rounded-full bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]"><CircleCheck className="size-8" /></motion.span>
              <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">Demande envoyée</h1>
                <p className="text-sm text-muted-foreground">{done}</p>
              </div>
              <div className="w-full rounded-lg border border-border bg-subtle p-4 text-left text-sm">
                <p className="font-medium">Et ensuite ?</p>
                <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-muted-foreground">
                  <li>Notre équipe vérifie votre demande (généralement sous 24 h).</li>
                  <li>Votre essai gratuit démarre dès la validation.</li>
                  <li>Connectez-vous sur <span className="font-mono text-foreground">{slug}.monapp.com</span> avec l'email et le mot de passe choisis.</li>
                </ol>
              </div>
              <Button asChild variant="secondary" className="w-full"><Link to={`/r/${slug}/login`}>Page de connexion de mon restaurant</Link></Button>
            </motion.div>
          ) : (
            <motion.div key="form" exit={{ opacity: 0 }} className="grid gap-10 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:pt-12">
              <section className="flex flex-col gap-6 lg:sticky lg:top-10 lg:self-start">
                <div className="flex flex-col gap-3">
                  <span className="text-[13px] font-medium text-brand-ink">Inscription d'un restaurant</span>
                  <h1 className="text-3xl font-semibold tracking-[-0.03em] sm:text-[40px] sm:leading-[1.1]">Gérez votre restaurant, de la salle à la caisse.</h1>
                  <p className="text-[15px] text-muted-foreground">Commandes, cuisine, réservations et stock dans un seul outil. Paiement de la licence par Flooz, TMoney, carte ou espèces.</p>
                </div>
                <ul className="flex flex-col gap-3 text-sm">
                  {[
                    { i: Clock, t: "Essai gratuit, sans engagement", d: "Validation de votre demande sous 24 h." },
                    { i: Smartphone, t: "Pensé pour le mobile", d: "Tablettes en salle, téléphone, écran en cuisine." },
                    { i: ShieldCheck, t: "Vos données protégées", d: "Comptes sécurisés, double authentification." },
                  ].map(({ i: I, t, d }) => (
                    <li key={t} className="flex gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card shadow-xs"><I className="size-4 text-brand-ink" /></span>
                      <span className="flex flex-col"><span className="font-medium">{t}</span><span className="text-muted-foreground">{d}</span></span>
                    </li>
                  ))}
                </ul>
              </section>

              <form onSubmit={onSubmit} noValidate className="flex flex-col gap-8 rounded-xl border border-border bg-card p-5 shadow-md sm:p-8">
                {error && <Callout tone="danger">{error}</Callout>}
                <section className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Eyebrow>1. Choisissez un plan</Eyebrow>
                    <Segmented ariaLabel="Facturation" size="sm" value={cycle} onChange={setCycle} className="w-auto" options={[{ value: "MONTHLY", label: "Mensuel" }, { value: "YEARLY", label: "Annuel" }]} />
                  </div>
                  {plans.isLoading ? <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
                    : plans.isError ? <Callout tone="danger">{errorMessage(plans.error)}</Callout>
                    : <Controller control={control} name="planId" render={({ field }) => <PlanPicker plans={plans.data ?? []} value={field.value} onChange={field.onChange} cycle={cycle} compact />} />}
                </section>

                <section className="flex flex-col gap-4">
                  <Eyebrow>2. Votre restaurant</Eyebrow>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nom du restaurant" required error={errors.restaurantName && "2 à 80 caractères"}>
                      <Input autoComplete="organization" placeholder="Chez Kofi" {...register("restaurantName")} />
                    </Field>
                    <Field label="Adresse de votre espace" required error={errors.slug?.message ?? (errors.slug && "3 à 40 caractères")} hint={slug ? <>Votre espace : <span className="font-mono text-foreground">{slug}.monapp.com</span></> : "Lettres minuscules, chiffres et tirets."}>
                      <Input className="font-mono" {...register("slug", { onChange: () => setSlugEdited(true) })} />
                    </Field>
                  </div>
                </section>

                <section className="flex flex-col gap-4">
                  <Eyebrow>3. Votre compte administrateur</Eyebrow>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Prénom" required error={errors.ownerFirstName && "Obligatoire"}><Input autoComplete="given-name" {...register("ownerFirstName")} /></Field>
                    <Field label="Nom" required error={errors.ownerLastName && "Obligatoire"}><Input autoComplete="family-name" {...register("ownerLastName")} /></Field>
                    <Field label="Email" required error={errors.email && "Adresse email invalide"}><Input type="email" inputMode="email" autoComplete="email" {...register("email")} /></Field>
                    <Field label="Téléphone" error={errors.phone && "6 à 20 caractères"} hint="Pour vous contacter lors de la validation."><Input type="tel" inputMode="tel" autoComplete="tel" placeholder="+228 90 00 00 00" {...register("phone", { setValueAs: (v: string) => v || undefined })} /></Field>
                  </div>
                  <Field label="Mot de passe" required error={errors.password?.message}>
                    <PasswordInput autoComplete="new-password" {...register("password")} />
                  </Field>
                  <PasswordChecklist password={password ?? ""} policy={DEFAULT_PASSWORD_POLICY} email={email} names={[first, last].filter(Boolean) as string[]} />
                </section>

                <div className="flex flex-col gap-3 border-t border-border pt-6">
                  <Button type="submit" variant="primary" size="lg" loading={submit.isPending}>Envoyer ma demande</Button>
                  <p className="text-center text-xs text-muted-foreground">En envoyant ce formulaire, vous acceptez d'être contacté au sujet de votre inscription.</p>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
