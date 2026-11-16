import type { ContractType, StaffFile } from "@restaurant/api-client";
import { staffProfileInputSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LockOpen, Pencil, UserRoundPlus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDateShort, formatFcfa } from "@/lib/format";
import { CONTRACT_LABEL, TENANT_ROLE_LABEL } from "@/lib/labels";
import { tenantKeys } from "@/lib/tenant-keys";
import { useTenant } from "../hooks";
import { useWeekStart } from "./hr-hooks";

/** Fiches du personnel : poste, contrat, embauche, contact d'urgence, taux horaire (administrateur) et code de pointage. */
export function ProfilesTab() {
  const t = useTenant();
  const [edit, setEdit] = React.useState<StaffFile | null>(null);
  const q = useQuery({ queryKey: tenantKeys.hrProfiles(t.root), queryFn: () => t.api.staffHr.profiles() });
  const active = (q.data ?? []).filter((s) => s.isActive);
  return (
    <div className="flex flex-col gap-4">
      {!t.isAdmin && <Callout tone="info">Le taux horaire n'est visible et modifiable que par l'administrateur.</Callout>}
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <SkeletonRows rows={5} className="rounded-lg border border-border" /> : (
        <ul className="overflow-hidden rounded-lg border border-border bg-card shadow-sm divide-y divide-border">
          {active.map((s) => (
            <li key={s.userId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar firstName={s.firstName} lastName={s.lastName} size={36} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  <span className="truncate text-[13px] text-muted-foreground">{TENANT_ROLE_LABEL[s.role]}{s.profile ? ` · ${s.profile.position}` : ""}</span>
                </div>
              </div>
              {s.profile ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                  <Badge tone="outline">{CONTRACT_LABEL[s.profile.contractType]}</Badge>
                  <span>Embauché le {formatDateShort(s.profile.hiredAt)}</span>
                  {s.profile.hourlyRate !== null && <span className="font-mono tabular-nums text-foreground">{formatFcfa(s.profile.hourlyRate)}/h</span>}
                  <Badge tone={s.profile.kioskCodeSet ? (s.profile.kioskLockedUntil ? "red" : "green") : "gray"} dot>
                    {s.profile.kioskLockedUntil ? "Code verrouillé" : s.profile.kioskCodeSet ? "Code de pointage" : "Sans code"}
                  </Badge>
                </div>
              ) : <Badge tone="amber" dot>Fiche à créer</Badge>}
              <Button variant={s.profile ? "secondary" : "primary"} size="sm" onClick={() => setEdit(s)} aria-label={`${s.profile ? "Modifier" : "Créer"} la fiche de ${s.name}`}>
                {s.profile ? <Pencil /> : <UserRoundPlus />}{s.profile ? "Modifier" : "Créer la fiche"}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ProfileDialog file={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function ProfileDialog({ file, onClose }: { file: StaffFile | null; onClose: () => void }) {
  const t = useTenant();
  const qc = useQueryClient();
  const w = useWeekStart("");
  const [v, setV] = React.useState({ position: "", contractType: "CDI" as ContractType, hiredAt: w.today, contractEndsAt: "", hourlyRate: "", overtimeMultiplier: "1,25", emergencyContact: "", notes: "" });
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!file) return;
    const p = file.profile;
    setError(null); setCodeError(null); setCode("");
    setV({
      position: p?.position ?? (file.role === "KITCHEN" ? "Cuisine" : file.role === "WAITER" ? "Serveur" : file.role === "MANAGER" ? "Gérant" : "Administrateur"),
      contractType: p?.contractType ?? "CDI", hiredAt: p?.hiredAt ?? w.today, contractEndsAt: p?.contractEndsAt ?? "",
      hourlyRate: p?.hourlyRate != null ? String(p.hourlyRate) : "", overtimeMultiplier: String(p?.overtimeMultiplier ?? 1.25).replace(".", ","),
      emergencyContact: p?.emergencyContact ?? "", notes: p?.notes ?? "",
    });
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => void qc.invalidateQueries({ queryKey: tenantKeys.hr(t.root) });
  const save = useMutation({
    mutationFn: () => {
      const parsed = staffProfileInputSchema.safeParse({
        position: v.position, contractType: v.contractType, hiredAt: v.hiredAt, contractEndsAt: v.contractEndsAt || null,
        emergencyContact: v.emergencyContact, notes: v.notes,
        ...(t.isAdmin ? { hourlyRate: Number(v.hourlyRate || 0), overtimeMultiplier: Number(v.overtimeMultiplier.replace(",", ".")) } : {}),
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Fiche invalide");
      return t.api.staffHr.saveProfile(file!.userId, parsed.data);
    },
    onSuccess: () => { toast.success("Fiche enregistrée"); refresh(); onClose(); },
    onError: (e) => setError(errorMessage(e)),
  });
  const setCodeM = useMutation({
    mutationFn: () => t.api.staffHr.setKioskCode(file!.userId, { code }),
    onSuccess: () => { toast.success("Code de pointage enregistré"); setCode(""); refresh(); onClose(); },
    onError: (e) => setCodeError(errorMessage(e)),
  });
  const unlock = useMutation({ mutationFn: () => t.api.staffHr.unlockKiosk(file!.userId), onSuccess: () => { toast.success("Pointage déverrouillé"); refresh(); onClose(); }, onError: (e) => toastError(e) });
  const removeCode = useMutation({ mutationFn: () => t.api.staffHr.removeKioskCode(file!.userId), onSuccess: () => { toast.success("Code supprimé"); refresh(); onClose(); }, onError: (e) => toastError(e) });
  const set = (patch: Partial<typeof v>) => setV({ ...v, ...patch });
  const hasProfile = !!file?.profile;
  return (
    <Dialog
      open={!!file} onOpenChange={(o) => !o && onClose()} size="md"
      title={file ? `Fiche de ${file.name}` : "Fiche"} description={file ? `${TENANT_ROLE_LABEL[file.role]} · ${file.email}` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Fermer</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Enregistrer la fiche</Button></>}
    >
      <div className="flex flex-col gap-5">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {error && <Callout tone="danger" className="sm:col-span-2">{error}</Callout>}
          <Field label="Poste" required><Input value={v.position} onChange={(e) => set({ position: e.target.value })} maxLength={60} /></Field>
          <Field label="Contrat"><NativeSelect value={v.contractType} onChange={(e) => set({ contractType: e.target.value as ContractType })}>{Object.entries(CONTRACT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
          <Field label="Date d'embauche" required><Input type="date" value={v.hiredAt} onChange={(e) => set({ hiredAt: e.target.value })} /></Field>
          <Field label="Fin de contrat" hint="Pour un CDD ou un extra"><Input type="date" value={v.contractEndsAt} onChange={(e) => set({ contractEndsAt: e.target.value })} /></Field>
          {t.isAdmin && (
            <>
              <Field label="Taux horaire" hint="Base du brut estimé"><Input inputMode="numeric" value={v.hourlyRate} onChange={(e) => set({ hourlyRate: e.target.value.replace(/\D/g, "") })} trailing={<span className="px-2 text-[12px]">FCFA/h</span>} className="font-mono" /></Field>
              <Field label="Majoration heures sup." hint="1,25 = +25 %"><Input inputMode="decimal" value={v.overtimeMultiplier} onChange={(e) => set({ overtimeMultiplier: e.target.value })} className="font-mono" /></Field>
            </>
          )}
          <Field label="Contact d'urgence" className="sm:col-span-2"><Input value={v.emergencyContact} onChange={(e) => set({ emergencyContact: e.target.value })} maxLength={120} placeholder="Nom et téléphone" /></Field>
          <Field label="Notes internes" className="sm:col-span-2"><Textarea value={v.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={500} className="min-h-[64px]" /></Field>
        </form>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-subtle p-4" aria-labelledby="kiosk-code-title">
          <div className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" aria-hidden /><h3 id="kiosk-code-title" className="text-sm font-semibold">Code de pointage (tablette)</h3></div>
          {!hasProfile ? <p className="text-[13px] text-muted-foreground">Enregistrez d'abord la fiche pour définir un code.</p> : (
            <>
              <p className="text-[13px] text-muted-foreground">4 à 6 chiffres, conservés sous forme hachée. Le pointage se verrouille après plusieurs essais ratés.</p>
              {codeError && <Callout tone="danger">{codeError}</Callout>}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Field label={file?.profile?.kioskCodeSet ? "Nouveau code" : "Code"} className="sm:w-48">
                  <Input inputMode="numeric" autoComplete="off" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="font-mono tracking-[0.3em]" />
                </Field>
                <Button variant="secondary" disabled={code.length < 4} loading={setCodeM.isPending} onClick={() => setCodeM.mutate()}>{file?.profile?.kioskCodeSet ? "Remplacer le code" : "Définir le code"}</Button>
                {file?.profile?.kioskLockedUntil && <Button variant="secondary" loading={unlock.isPending} onClick={() => unlock.mutate()}><LockOpen /> Déverrouiller</Button>}
                {file?.profile?.kioskCodeSet && <Button variant="danger-ghost" loading={removeCode.isPending} onClick={() => removeCode.mutate()}>Supprimer le code</Button>}
              </div>
            </>
          )}
        </section>
      </div>
    </Dialog>
  );
}
