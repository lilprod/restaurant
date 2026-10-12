import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordSchema } from "@restaurant/validation";
import { ArrowLeft, MailCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthCard, AuthLayout } from "@/layouts/auth-layout";
import { toastError } from "@/lib/errors";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";

const schema = forgotPasswordSchema.pick({ email: true });

export function ForgotPasswordPage() {
  const { auth, slug } = useSession();
  const to = useSpacePath();
  const [sent, setSent] = React.useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    try {
      const r = await auth.forgotPassword({ email, ...(slug ? { tenantSlug: slug } : {}) });
      setSent(r.message);
    } catch (e) { toastError(e); }
  });

  return (
    <AuthLayout>
      <AnimatePresence mode="wait" initial={false}>
        {sent ? (
          <motion.div key="sent" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.2 }}>
            <AuthCard title="Vérifiez vos emails" description={sent}>
              <div className="flex flex-col items-center gap-5">
                <span className="flex size-14 items-center justify-center rounded-full bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]">
                  <MailCheck className="size-6" />
                </span>
                <p className="text-center text-sm text-muted-foreground">Le lien est valable 1 heure et ne peut servir qu'une fois. Pensez à vérifier vos courriers indésirables.</p>
                <Button asChild variant="secondary" className="w-full"><Link to={to("/login")}>Retour à la connexion</Link></Button>
              </div>
            </AuthCard>
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0 }}>
            <AuthCard title="Mot de passe oublié" description="Indiquez votre email : nous vous enverrons un lien pour choisir un nouveau mot de passe.">
              <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
                <Field label="Email" error={form.formState.errors.email && "Adresse email invalide"}>
                  <Input type="email" autoComplete="email" inputMode="email" autoFocus {...form.register("email")} />
                </Field>
                <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>Envoyer le lien</Button>
                <Link to={to("/login")} className="mx-auto inline-flex min-h-11 items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground sm:min-h-0">
                  <ArrowLeft className="size-3.5" /> Retour à la connexion
                </Link>
              </form>
            </AuthCard>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthLayout>
  );
}
