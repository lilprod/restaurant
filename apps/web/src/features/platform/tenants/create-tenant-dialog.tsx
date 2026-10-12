import { zodResolver } from "@hookform/resolvers/zod";
import { DEFAULT_PASSWORD_POLICY } from "@restaurant/utils";
import { createTenantSchema, type CreateTenantInput } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PasswordChecklist } from "@/components/password-checklist";
import { PasswordInput } from "@/components/password-input";
import { PlanPicker } from "@/components/plan-picker";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Eyebrow } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { applyApiErrors, errorMessage } from "@/lib/errors";
import { generatePassword, slugify } from "@/lib/slug";
import { papi, pk } from "../hooks";

export function CreateTenantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const plans = useQuery({ queryKey: pk.plans, queryFn: papi.plans.list, enabled: open });
  const [slugEdited, setSlugEdited] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const form = useForm<CreateTenantInput>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { name: "", slug: "", email: "", planId: "", admin: { firstName: "", lastName: "", email: "", password: "" } },
  });
  const { register, control, setValue, formState: { errors } } = form;
  const [name, password, adminEmail, first, last] = useWatch({ control, name: ["name", "admin.password", "admin.email", "admin.firstName", "admin.lastName"] });

  React.useEffect(() => { if (!slugEdited) setValue("slug", slugify(name ?? "")); }, [name, slugEdited, setValue]);
  React.useEffect(() => { if (open) { form.reset(); setSlugEdited(false); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const first = plans.data?.find((p) => p.isActive);
    if (first && !form.getValues("planId")) setValue("planId", first.id);
  }, [plans.data, form, setValue]);

  const create = useMutation({
    mutationFn: (v: CreateTenantInput) => papi.tenants.create({ ...v, phone: v.phone || undefined, address: v.address || undefined }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: pk.tenantsAll });
      void qc.invalidateQueries({ queryKey: pk.dashboard });
      toast.success("Restaurant créé", { description: `${t.name} — essai démarré. L'administrateur devra changer son mot de passe à la première connexion.` });
      onOpenChange(false);
      navigate(`/admin/restaurants/${t.id}`);
    },
    onError: (e) => {
      applyApiErrors(e, form.setError);
      setError(errorMessage(e));
    },
  });

  const onSubmit = form.handleSubmit((v) => { setError(null); create.mutate(v); });
  const activePlans = plans.data?.filter((p) => p.isActive) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      dismissable={!create.isPending}
      title="Créer un restaurant"
      description="Crée le restaurant, son administrateur et une licence d'essai selon le plan choisi."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>Annuler</Button>
        <Button variant="primary" onClick={onSubmit} loading={create.isPending}>Créer le restaurant</Button>
      </>}
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}
        <section className="flex flex-col gap-4">
          <Eyebrow>Restaurant</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom" required error={errors.name && "2 à 80 caractères"}>
              <Input autoFocus placeholder="Chez Kofi" {...register("name")} />
            </Field>
            <Field label="Adresse (sous-domaine)" required error={errors.slug?.message ?? (errors.slug && "3 à 40 caractères")} hint="Minuscules, chiffres et tirets.">
              <Input className="font-mono" trailing={<span className="pr-2 font-mono text-xs text-muted-foreground">.monapp.com</span>} {...register("slug", { onChange: () => setSlugEdited(true) })} />
            </Field>
            <Field label="Email du restaurant" required error={errors.email && "Adresse email invalide"}>
              <Input type="email" inputMode="email" {...register("email")} />
            </Field>
            <Field label="Téléphone" error={errors.phone && "6 à 20 caractères"}>
              <Input type="tel" inputMode="tel" placeholder="+228 90 00 00 00" {...register("phone", { setValueAs: (v: string) => v || undefined })} />
            </Field>
          </div>
          <Field label="Adresse postale">
            <Input placeholder="Rue, quartier, ville" {...register("address", { setValueAs: (v: string) => v || undefined })} />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <Eyebrow>Plan</Eyebrow>
          {plans.isLoading ? <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div> : (
            <Controller control={control} name="planId" render={({ field }) => <PlanPicker plans={activePlans} value={field.value} onChange={field.onChange} compact />} />
          )}
          {errors.planId && <p role="alert" className="text-[12.5px] text-danger">Choisissez un plan</p>}
        </section>

        <section className="flex flex-col gap-4">
          <Eyebrow>Administrateur du restaurant</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom" required error={errors.admin?.firstName && "Obligatoire"}><Input autoComplete="off" {...register("admin.firstName")} /></Field>
            <Field label="Nom" required error={errors.admin?.lastName && "Obligatoire"}><Input autoComplete="off" {...register("admin.lastName")} /></Field>
          </div>
          <Field label="Email de connexion" required error={errors.admin?.email && "Adresse email invalide"}>
            <Input type="email" inputMode="email" autoComplete="off" {...register("admin.email")} />
          </Field>
          <Field
            label="Mot de passe provisoire"
            required
            error={errors.admin?.password?.message}
            hint="À transmettre à l'administrateur : il devra le changer à sa première connexion."
            aside={
              <div className="flex items-center">
                <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setValue("admin.password", generatePassword(), { shouldValidate: true })}><Wand2 /> Générer</Button>
                {password && <CopyButton value={password} />}
              </div>
            }
          >
            <PasswordInput autoComplete="new-password" className="font-mono" {...register("admin.password")} />
          </Field>
          <PasswordChecklist password={password ?? ""} policy={DEFAULT_PASSWORD_POLICY} email={adminEmail} names={[first, last].filter(Boolean) as string[]} />
        </section>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
