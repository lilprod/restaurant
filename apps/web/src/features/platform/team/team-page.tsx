import type { PlatformRole, PlatformUserView } from "@restaurant/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, UserPlus, Headset } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { useConfirm } from "@/components/ui/confirm";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { PLATFORM_ROLE_LABEL } from "@/lib/labels";
import { useSession } from "@/providers/session";
import { TempPasswordDialog } from "../../security/temp-password-dialog";
import { UsersSecurityTable } from "../../security/users-security-table";
import { papi, pk } from "../hooks";
import { Callout } from "@/components/ui/callout";

export function TeamPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = React.useState(false);
  const role = useMutation({
    mutationFn: ({ u, r }: { u: PlatformUserView; r: PlatformRole }) => papi.users.update(u.id, { role: r }),
    onSuccess: (u) => { toast.success(`${u.firstName} est maintenant ${PLATFORM_ROLE_LABEL[u.role]}`); void qc.invalidateQueries({ queryKey: pk.users }); },
    onError: (e) => toastError(e),
  });

  return (
    <>
      <PageHeader
        title="Équipe"
        description="Comptes de l'éditeur. Le rôle Support consulte tout mais ne modifie rien."
        actions={<Button variant="primary" onClick={() => setCreateOpen(true)}><UserPlus /> Ajouter un membre</Button>}
      />
      <UsersSecurityTable<PlatformUserView>
        adapter={{
          key: pk.users,
          list: papi.users.list,
          action: (id, a) => papi.users.action(id, a),
          setActive: (id, v) => papi.users.update(id, { isActive: v }),
          canWrite: true,
          roleLabels: PLATFORM_ROLE_LABEL,
          currentUserId: user?.id,
          extraActions: (u) => u.id === user?.id ? null : (
            <>
              <DropdownMenuItem onSelect={() => {
                const next: PlatformRole = u.role === "SUPER_ADMIN" ? "SUPPORT" : "SUPER_ADMIN";
                confirm({
                  title: `Passer ${u.firstName} en ${PLATFORM_ROLE_LABEL[next]} ?`,
                  description: next === "SUPER_ADMIN" ? "Il pourra tout modifier : restaurants, paiements, réglages et équipe." : "Il ne pourra plus rien modifier, uniquement consulter.",
                  confirmLabel: "Changer le rôle", tone: next === "SUPER_ADMIN" ? "danger" : "primary",
                  onConfirm: () => role.mutateAsync({ u, r: next }),
                });
              }}>
                {u.role === "SUPER_ADMIN" ? <><Headset /> Passer en Support</> : <><ShieldCheck /> Passer en Super admin</>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ),
        }}
      />
      <CreateMemberDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CreateMemberDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [v, setV] = React.useState({ email: "", firstName: "", lastName: "", role: "SUPPORT" as PlatformRole });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [temp, setTemp] = React.useState<{ value: string; who: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { if (open) { setV({ email: "", firstName: "", lastName: "", role: "SUPPORT" }); setErrors({}); setError(null); } }, [open]);
  const create = useMutation({
    mutationFn: () => papi.users.create(v),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: pk.users });
      onOpenChange(false);
      setTemp({ value: u.temporaryPassword, who: `${u.firstName} ${u.lastName}` });
    },
    onError: (e) => {
      const errs: Record<string, string> = {};
      applyApiErrors(e, ((path: string, err: { message?: string }) => { errs[path] = err.message ?? ""; }) as never);
      setErrors(errs);
      setError(errorMessage(e));
    },
  });
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(v.email)) errs.email = "Adresse email invalide";
    if (!v.firstName.trim()) errs.firstName = "Obligatoire";
    if (!v.lastName.trim()) errs.lastName = "Obligatoire";
    setErrors(errs);
    if (!Object.keys(errs).length) create.mutate();
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title="Ajouter un membre" description="Un mot de passe temporaire sera généré ; il devra le changer à sa première connexion."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button><Button variant="primary" loading={create.isPending} onClick={() => submit()}>Créer le compte</Button></>}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom" required error={errors.firstName}><Input autoFocus value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} /></Field>
            <Field label="Nom" required error={errors.lastName}><Input value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} /></Field>
          </div>
          <Field label="Email" required error={errors.email}><Input type="email" inputMode="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field label="Rôle" hint={v.role === "SUPPORT" ? "Consultation uniquement." : "Accès complet en lecture et écriture."}>
            <Segmented ariaLabel="Rôle" value={v.role} onChange={(r) => setV({ ...v, role: r })} className="sm:w-full"
              options={[{ value: "SUPPORT", label: "Support", icon: <Headset /> }, { value: "SUPER_ADMIN", label: "Super admin", icon: <ShieldCheck /> }]} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Dialog>
      <TempPasswordDialog value={temp?.value ?? null} who={temp?.who} onClose={() => setTemp(null)} />
    </>
  );
}
