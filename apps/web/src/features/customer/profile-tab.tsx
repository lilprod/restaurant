import { ApiError } from "@restaurant/api-client";
import { customerProfileSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Download, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchRow } from "@/components/ui/switch";
import { errorMessage, toastError } from "@/lib/errors";
import { useSession } from "@/providers/session";
import { useCustomer } from "./hooks";

const Section = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
    <div><h2 className="text-[15px] font-semibold">{title}</h2>{description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}</div>
    {children}
  </section>
);

/** Profil, préférences de notification, mot de passe, export et suppression du compte (RGPD). */
export function ProfileTab() {
  const c = useCustomer();
  const session = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: c.key("profile"), queryFn: () => c.api.profile() });
  const p = q.data;
  const [first, setFirst] = React.useState("");
  const [last, setLast] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { if (p) { setFirst(p.firstName); setLast(p.lastName); setPhone(p.phone ?? ""); } }, [p?.id, p?.firstName, p?.lastName, p?.phone]);

  const save = useMutation({
    mutationFn: () => {
      const parsed = customerProfileSchema.safeParse({ firstName: first, lastName: last, phone });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Profil invalide");
      return c.api.updateProfile(parsed.data);
    },
    onSuccess: (next) => { qc.setQueryData(c.key("profile"), next); setErr(null); toast.success("Profil enregistré"); void session.reloadProfile(); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const prefs = useMutation({
    mutationFn: (v: { reservationReminders: boolean; orderReadySms: boolean }) => c.api.setPreferences(v),
    onSuccess: (next) => { qc.setQueryData(c.key("profile"), next); toast.success("Préférences enregistrées"); },
    onError: (e) => toastError(e),
  });

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!p) return <div className="flex flex-col gap-4" aria-busy="true"><Skeleton className="h-60 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Mes informations">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prénom"><Input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" /></Field>
            <Field label="Nom"><Input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" /></Field>
          </div>
          <Field label="Email" hint={p.emailVerified ? undefined : "Non vérifié : vérifiez-le pour retrouver vos réservations."}>
            <Input value={p.email} readOnly disabled trailing={p.emailVerified ? <BadgeCheck className="mr-3 size-4 text-[var(--tone-green-dot)]" aria-label="Email vérifié" /> : undefined} />
          </Field>
          <Field label="Téléphone" hint="Utilisé pour le SMS « commande prête »."><Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="90 11 22 33" /></Field>
          {err && <Callout tone="danger" title={err} />}
          <Button type="submit" variant="primary" size="lg" className="w-fit" loading={save.isPending}>Enregistrer</Button>
        </form>
      </Section>

      <Section title="Notifications" description="Les messages liés à une réservation ou une commande en cours sont toujours envoyés.">
        <SwitchRow label="Rappel de réservation" description="Un message la veille de votre réservation." checked={p.notificationPrefs.reservationReminders} disabled={prefs.isPending}
          onCheckedChange={(v) => prefs.mutate({ ...p.notificationPrefs, reservationReminders: v })} />
        <SwitchRow label="SMS « commande prête »" description="Un SMS quand votre commande à emporter est prête." checked={p.notificationPrefs.orderReadySms} disabled={prefs.isPending}
          onCheckedChange={(v) => prefs.mutate({ ...p.notificationPrefs, orderReadySms: v })} />
      </Section>

      <PasswordSection />

      <Section title="Mes données" description="Vous pouvez récupérer toutes vos données ou supprimer votre compte. La suppression efface vos informations personnelles ; l'historique du restaurant est conservé sans votre nom.">
        <div className="flex flex-col gap-2 sm:flex-row">
          <ExportButton />
          <DeleteAccount />
        </div>
      </Section>
    </div>
  );
}

function PasswordSection() {
  const session = useSession();
  const [cur, setCur] = React.useState("");
  const [next, setNext] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => session.account.changePassword({ currentPassword: cur, newPassword: next }),
    onSuccess: async (r) => {
      toast.success("Mot de passe modifié");
      setCur(""); setNext(""); setErr(null);
      if (r.reloginRequired) await session.logout({ silent: true });
    },
    onError: (e) => setErr(e instanceof ApiError && e.errors.length ? e.errors.map((x) => x.message).join(" · ") : errorMessage(e)),
  });
  return (
    <Section title="Mot de passe">
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-4">
        <Field label="Mot de passe actuel"><PasswordInput autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Nouveau mot de passe" hint="8 caractères minimum, avec une majuscule, une minuscule et un chiffre."><PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        {err && <Callout tone="danger" title={err} />}
        <Button type="submit" variant="secondary" size="lg" className="w-fit" loading={m.isPending} disabled={!cur || !next}>Changer le mot de passe</Button>
      </form>
    </Section>
  );
}

function ExportButton() {
  const c = useCustomer();
  const m = useMutation({
    mutationFn: () => c.api.export(),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = `mes-donnees-${c.slug}.json`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Export téléchargé");
    },
    onError: (e) => toastError(e),
  });
  return <Button variant="secondary" size="lg" onClick={() => m.mutate()} loading={m.isPending}><Download /> Exporter mes données</Button>;
}

function DeleteAccount() {
  const c = useCustomer();
  const session = useSession();
  const [open, setOpen] = React.useState(false);
  const [pw, setPw] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => c.api.deleteAccount(pw),
    onSuccess: async () => { setOpen(false); await session.logout({ silent: true }); toast.success("Votre compte a été supprimé"); },
    onError: (e) => setErr(errorMessage(e)),
  });
  return (
    <>
      <Button variant="danger-ghost" size="lg" onClick={() => { setPw(""); setErr(null); setOpen(true); }}><Trash2 /> Supprimer mon compte</Button>
      <Dialog open={open} onOpenChange={setOpen} title="Supprimer mon compte ?" size="sm"
        description="Vos réservations à venir seront annulées et vos informations personnelles effacées. Cette action est définitive."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Garder mon compte</Button><Button variant="danger" onClick={() => m.mutate()} loading={m.isPending} disabled={!pw}>Supprimer définitivement</Button></>}>
        <Field label="Confirmez avec votre mot de passe" error={err ?? undefined}><PasswordInput autoComplete="current-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null); }} /></Field>
      </Dialog>
    </>
  );
}
