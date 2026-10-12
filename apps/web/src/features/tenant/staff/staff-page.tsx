import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError, type StaffMember, type StaffRole } from "@restaurant/api-client";
import { createStaffSchema, updateStaffSchema } from "@restaurant/validation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, UserPlus } from "lucide-react";
import * as React from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";
import { applyApiErrors, errorMessage } from "@/lib/errors";
import { STAFF_ROLE_HINT, STAFF_ROLES, TENANT_ROLE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { TempPasswordDialog } from "../../security/temp-password-dialog";
import { UsersSecurityTable, type SecurityUser } from "../../security/users-security-table";
import { useTenant } from "../hooks";

type StaffRow = StaffMember & SecurityUser;

/** Équipe : l'administrateur crée et modifie les comptes ; le gérant consulte. Actions de sécurité réutilisées. */
export function StaffPage() {
  const t = useTenant();
  const { user } = useSession();
  const [create, setCreate] = React.useState(false);
  const [edit, setEdit] = React.useState<StaffRow | null>(null);

  const list = React.useCallback(async (): Promise<StaffRow[]> => {
    const [staff, security] = await Promise.all([t.api.staff.list(), t.isAdmin ? t.api.security.users() : Promise.resolve([])]);
    const locked = new Map(security.map((s) => [s.id, s.locked]));
    return staff.map((s) => ({ ...s, locked: locked.get(s.id) ?? false }));
  }, [t.api, t.isAdmin]);

  return (
    <>
      <PageHeader
        title="Équipe"
        description="Comptes du personnel : chaque rôle ne voit que ce dont il a besoin (salle, cuisine, gestion)."
        actions={t.isAdmin && <Button variant="primary" onClick={() => setCreate(true)}><UserPlus /> Ajouter un membre</Button>}
      />
      {!t.isAdmin && <Callout className="mb-4" tone="info">Consultation seule : seul l'administrateur ajoute ou modifie les membres de l'équipe.</Callout>}
      <UsersSecurityTable<StaffRow>
        adapter={{
          key: tenantKeys.staff(t.root),
          list,
          action: (id, a) => t.api.security.userAction(id, a),
          setActive: t.isAdmin ? (id, v) => t.api.security.setActive(id, v) : undefined,
          canWrite: t.isAdmin,
          roleLabels: TENANT_ROLE_LABEL,
          currentUserId: user?.id,
          extraActions: (u) => (
            <>
              <DropdownMenuItem onSelect={() => setEdit(u)}><Pencil /> Modifier le profil et le rôle</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ),
        }}
        emptyAction={t.isAdmin ? <Button variant="primary" onClick={() => setCreate(true)}><UserPlus /> Ajouter un membre</Button> : undefined}
      />
      {t.isAdmin && <CreateStaffDialog open={create} onOpenChange={setCreate} />}
      {t.isAdmin && <EditStaffDialog member={edit} onClose={() => setEdit(null)} self={edit?.id === user?.id} />}
    </>
  );
}

type CreateValues = z.input<typeof createStaffSchema>;

function RolePicker({ control, disabled }: { control: Control<{ role?: StaffRole } & Record<string, unknown>>; disabled?: boolean }) {
  return (
    <Controller control={control} name="role" render={({ field }) => (
      <div role="radiogroup" aria-label="Rôle" className="grid gap-2 sm:grid-cols-2">
        {STAFF_ROLES.map((r) => {
          const on = field.value === r;
          return (
            <button key={r} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => field.onChange(r)}
              className={cn("flex min-h-16 items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                on ? "border-brand-ink bg-brand-tint" : "border-border hover:bg-hover")}>
              <span aria-hidden className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-brand-ink bg-brand text-brand-foreground" : "border-border-strong")}>
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{TENANT_ROLE_LABEL[r]}</span>
                <span className="text-[12.5px] leading-snug text-muted-foreground">{STAFF_ROLE_HINT[r]}</span>
              </span>
            </button>
          );
        })}
      </div>
    )} />
  );
}

function PlanLimit({ message }: { message: string }) {
  const t = useTenant();
  const to = useSpacePath();
  return (
    <Callout tone="warning" title="Limite de votre plan atteinte" action={t.canSeeLicense ? <Button asChild size="sm" variant="secondary"><Link to={to("/licence")}>Voir les plans</Link></Button> : undefined}>
      {message} Vous pouvez aussi désactiver un compte inutilisé.
    </Callout>
  );
}

function CreateStaffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const [temp, setTemp] = React.useState<{ value: string; who: string } | null>(null);
  const [limit, setLimit] = React.useState<string | null>(null);
  const form = useForm<CreateValues>({ resolver: zodResolver(createStaffSchema), defaultValues: { email: "", firstName: "", lastName: "", phone: "", role: "WAITER" } });
  React.useEffect(() => { if (open) { form.reset({ email: "", firstName: "", lastName: "", phone: "", role: "WAITER" }); setLimit(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = useMutation({
    mutationFn: (v: z.output<typeof createStaffSchema>) => t.api.staff.create(v),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: tenantKeys.staff(t.root) });
      onOpenChange(false);
      toast.success(`Compte de ${u.firstName} créé`);
      setTemp({ value: u.temporaryPassword, who: `${u.firstName} ${u.lastName} (${u.email})` });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isPlanLimit) { setLimit(e.message); return; }
      if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) });
    },
  });
  const submit = form.handleSubmit((v) => create.mutate(v as z.output<typeof createStaffSchema>));
  const err = form.formState.errors;
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title="Ajouter un membre" description="Un mot de passe temporaire sera affiché une seule fois ; il devra le changer à sa première connexion."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button><Button variant="primary" loading={create.isPending} onClick={submit}>Créer le compte</Button></>}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {limit && <PlanLimit message={limit} />}
          {err.root && <Callout tone="danger">{err.root.message}</Callout>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom" required error={err.firstName?.message}><Input autoFocus autoComplete="off" {...form.register("firstName")} /></Field>
            <Field label="Nom" required error={err.lastName?.message}><Input autoComplete="off" {...form.register("lastName")} /></Field>
          </div>
          <Field label="Email" required error={err.email?.message} hint="Identifiant de connexion."><Input type="email" inputMode="email" autoComplete="off" {...form.register("email")} /></Field>
          <Field label="Téléphone" error={err.phone?.message}><Input type="tel" inputMode="tel" placeholder="+228 90 00 00 00" {...form.register("phone")} /></Field>
          <Field label="Rôle" error={err.role?.message}><span><RolePicker control={form.control as never} /></span></Field>
          <button type="submit" hidden />
        </form>
      </Dialog>
      <TempPasswordDialog value={temp?.value ?? null} who={temp?.who} onClose={() => setTemp(null)} />
    </>
  );
}

type EditValues = z.input<typeof updateStaffSchema>;

function EditStaffDialog({ member, onClose, self }: { member: StaffRow | null; onClose: () => void; self: boolean }) {
  const t = useTenant();
  const qc = useQueryClient();
  const form = useForm<EditValues>({ resolver: zodResolver(updateStaffSchema) });
  React.useEffect(() => {
    if (member) form.reset({ firstName: member.firstName, lastName: member.lastName, phone: member.phone ?? "", role: member.role });
  }, [member]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: (v: z.output<typeof updateStaffSchema>) => t.api.staff.update(member!.id, { ...v, phone: v.phone ?? "", role: self ? undefined : v.role }),
    onSuccess: (u) => { void qc.invalidateQueries({ queryKey: tenantKeys.staff(t.root) }); toast.success(`${u.firstName} ${u.lastName} : profil enregistré`); onClose(); },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) form.setError("root", { message: errorMessage(e) }); },
  });
  const submit = form.handleSubmit((v) => save.mutate(v as z.output<typeof updateStaffSchema>));
  const err = form.formState.errors;
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()} title={member ? `Modifier ${member.firstName} ${member.lastName}` : ""} description={member?.email}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Enregistrer</Button></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {err.root && <Callout tone="danger">{err.root.message}</Callout>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom" required error={err.firstName?.message}><Input {...form.register("firstName")} /></Field>
          <Field label="Nom" required error={err.lastName?.message}><Input {...form.register("lastName")} /></Field>
        </div>
        <Field label="Téléphone" error={err.phone?.message}><Input type="tel" inputMode="tel" {...form.register("phone")} /></Field>
        <Field label="Rôle" hint={self ? "Vous ne pouvez pas changer votre propre rôle." : undefined}><span><RolePicker control={form.control as never} disabled={self} /></span></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
