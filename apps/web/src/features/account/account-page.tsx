import { zodResolver } from "@hookform/resolvers/zod";
import type { PasswordPolicy } from "@restaurant/utils";
import { profileUpdateSchema } from "@restaurant/validation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Download, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { isPasswordValid, PasswordChecklist } from "@/components/password-checklist";
import { PasswordInput } from "@/components/password-input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useConfirm } from "@/components/ui/confirm";
import { copyText } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader, SettingsSection } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { applyApiErrors, errorMessage, toastError } from "@/lib/errors";
import { precheckFile } from "@/lib/files";
import { downloadText } from "@/lib/files";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { PLATFORM_ROLE_LABEL, TENANT_ROLE_LABEL } from "@/lib/labels";
import { DEFAULT_POLICY_BY_SPACE } from "@/lib/policy";
import { useUrlParam } from "@/lib/use-url-state";
import { describeUserAgent } from "@/lib/user-agent";
import { useSession, useUser } from "@/providers/session";
import { platformSpace, getTenantSpace } from "@/app/spaces";
import { TwoFactorSetupFlow } from "../auth/two-factor-setup";
import { DeviceIcon, LoginEventsTable } from "../security/login-events-table";

export function AccountPage() {
  const user = useUser();
  const [tab, setTab] = useUrlParam("onglet", "profil");
  const roleLabel = (useSession().space === "platform" ? PLATFORM_ROLE_LABEL : TENANT_ROLE_LABEL)[user.role] ?? user.role;
  return (
    <>
      <PageHeader title="Mon compte" description={<>{user.email} · {roleLabel}</>} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profil">Profil</TabsTrigger>
          <TabsTrigger value="securite">Mot de passe et 2FA</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="historique">Historique</TabsTrigger>
        </TabsList>
        <TabsContent value="profil"><ProfileTab /></TabsContent>
        <TabsContent value="securite"><div className="flex flex-col gap-6"><PasswordCard /><TwoFactorCard /></div></TabsContent>
        <TabsContent value="sessions"><SessionsTab /></TabsContent>
        <TabsContent value="historique"><HistoryTab /></TabsContent>
      </Tabs>
    </>
  );
}

type ProfileValues = z.infer<typeof profileUpdateSchema>;

function ProfileTab() {
  const session = useSession();
  const user = useUser();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileUpdateSchema, undefined, { raw: true }),
    defaultValues: { firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? "", locale: (user.locale as "fr" | "en") ?? "fr" },
  });
  const save = useMutation({
    mutationFn: (v: ProfileValues) => session.account.updateProfile(v),
    onSuccess: async (p) => {
      await session.reloadProfile();
      form.reset({ firstName: p.firstName, lastName: p.lastName, phone: p.phone ?? "", locale: p.locale as "fr" | "en" });
      toast.success("Profil mis à jour");
    },
    onError: (e) => { if (!applyApiErrors(e, form.setError)) toastError(e); },
  });

  async function onAvatar(file?: File) {
    if (!file) return;
    const err = precheckFile(file, "avatar");
    if (err) { toast.error(err); return; }
    setUploading(true);
    try { await session.account.uploadAvatar(file); await session.reloadProfile(); toast.success("Photo mise à jour"); }
    catch (e) { toastError(e); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  const e = form.formState.errors;
  return (
    <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
      <SettingsSection
        title="Profil"
        description="Votre nom apparaît dans les journaux et sur les reçus que vous enregistrez."
        footer={<><span className="text-[13px] text-muted-foreground">Dernière connexion : {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "—"}</span>
          <Button type="submit" variant="primary" size="sm" loading={save.isPending} disabled={!form.formState.isDirty}>Enregistrer</Button></>}
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar src={user.avatarUrl} firstName={user.firstName} lastName={user.lastName} size={64} />
            {uploading && <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70"><Spinner /></span>}
          </div>
          <div className="flex flex-col gap-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}><Camera /> Changer la photo</Button>
            <span className="text-xs text-muted-foreground">PNG, JPEG ou WebP · 1 Mo max</span>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} onChange={(ev) => void onAvatar(ev.target.files?.[0])} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom" error={e.firstName && "Obligatoire"}><Input autoComplete="given-name" {...form.register("firstName")} /></Field>
          <Field label="Nom" error={e.lastName && "Obligatoire"}><Input autoComplete="family-name" {...form.register("lastName")} /></Field>
          <Field label="Email" hint="Pour changer d'email, contactez un administrateur."><Input value={user.email} disabled readOnly /></Field>
          <Field label="Téléphone" error={e.phone && "6 à 25 caractères"}><Input type="tel" inputMode="tel" autoComplete="tel" {...form.register("phone")} /></Field>
          <Field label="Langue de l'interface">
            <Controller control={form.control} name="locale" render={({ field }) => (
              <Segmented ariaLabel="Langue" value={field.value ?? "fr"} onChange={field.onChange} options={[{ value: "fr", label: "Français" }, { value: "en", label: "English" }]} className="sm:w-full" />
            )} />
          </Field>
        </div>
      </SettingsSection>
    </form>
  );
}

/** Politique effective quand le rôle peut la lire (SuperAdmin, administrateur du restaurant), sinon défauts de l'espace. */
function usePolicy(): PasswordPolicy {
  const session = useSession();
  const user = useUser();
  const canRead = session.space === "platform" ? user.role === "SUPER_ADMIN" : user.role === "ADMIN";
  const q = useQuery({
    queryKey: [...session.queryKey, "policy"],
    queryFn: async () => session.space === "platform"
      ? (await platformSpace.api.settings.get("security")).passwordPolicy
      : (await getTenantSpace(session.slug!).api.settings.get("security")).passwordPolicy,
    enabled: canRead,
    staleTime: 5 * 60_000,
  });
  return q.data ?? DEFAULT_POLICY_BY_SPACE[session.space];
}

function PasswordCard() {
  const session = useSession();
  const user = useUser();
  const policy = usePolicy();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const ctx = { email: user.email, names: [user.firstName, user.lastName] };
  const valid = current.length > 0 && isPasswordValid(next, policy, ctx) && next === confirm;
  const change = useMutation({
    mutationFn: () => session.account.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: async (r) => {
      setCurrent(""); setNext(""); setConfirm(""); setError(null);
      if (r.reloginRequired) { await session.logout({ silent: true }); toast.success("Mot de passe changé", { description: "Reconnectez-vous." }); return; }
      toast.success("Mot de passe changé", { description: "Vos autres sessions ont été fermées." });
      await session.reloadProfile();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (valid) change.mutate(); }} noValidate>
      <SettingsSection
        title="Mot de passe"
        description={user.passwordChangedAt ? `Modifié ${formatRelative(user.passwordChangedAt)}. Le changer ferme vos autres sessions.` : "Le changer ferme vos autres sessions."}
        footer={<><span className="text-[13px] text-muted-foreground">Règles de votre organisation</span><Button type="submit" variant="primary" size="sm" loading={change.isPending} disabled={!valid}>Changer le mot de passe</Button></>}
      >
        {error && <Callout tone="danger">{error}</Callout>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Mot de passe actuel"><PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
          <Field label="Nouveau mot de passe"><PasswordInput autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Confirmation" error={confirm && confirm !== next ? "Ne correspond pas" : undefined}><PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        </div>
        <PasswordChecklist password={next} policy={policy} {...ctx} />
      </SettingsSection>
    </form>
  );
}

function TwoFactorCard() {
  const session = useSession();
  const user = useUser();
  const [setupOpen, setSetupOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"disable" | "regenerate" | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  return (
    <SettingsSection
      title="Double authentification"
      description="Un code de votre téléphone est demandé à chaque connexion, en plus du mot de passe."
      footer={user.twoFactorEnabled ? (
        <>
          <span className="text-[13px] text-muted-foreground">{user.twoFactorRequired ? "Obligatoire pour votre rôle." : "Recommandée pour tous les comptes."}</span>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="sm" variant="secondary" onClick={() => setMode("regenerate")}><RefreshCw /> Régénérer les codes</Button>
            {!user.twoFactorRequired && <Button size="sm" variant="danger-ghost" onClick={() => setMode("disable")}><ShieldOff /> Désactiver</Button>}
          </div>
        </>
      ) : (
        <><span className="text-[13px] text-muted-foreground">Prend moins d'une minute.</span><Button size="sm" variant="primary" onClick={() => setSetupOpen(true)}><ShieldCheck /> Activer la 2FA</Button></>
      )}
    >
      <div className="flex items-center gap-4">
        <span className={user.twoFactorEnabled ? "flex size-11 items-center justify-center rounded-full bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]" : "flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"}>
          {user.twoFactorEnabled ? <ShieldCheck className="size-5" /> : <ShieldOff className="size-5" />}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            {user.twoFactorEnabled ? "Activée" : "Désactivée"}
            <Badge tone={user.twoFactorEnabled ? "green" : "gray"} dot>{user.twoFactorEnabled ? "Protégé" : "Non protégé"}</Badge>
          </span>
          {user.twoFactorEnabled && (
            <span className="text-[13px] text-muted-foreground">
              <span className="font-mono">{user.recoveryCodesLeft}</span> code{user.recoveryCodesLeft > 1 ? "s" : ""} de secours restant{user.recoveryCodesLeft > 1 ? "s" : ""}
              {user.recoveryCodesLeft <= 2 && <span className="text-warning"> — pensez à les régénérer</span>}
            </span>
          )}
        </div>
      </div>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen} size="lg" title="Activer la double authentification" dismissable={false}>
        {setupOpen && <TwoFactorSetupFlow onCancel={() => setSetupOpen(false)} onDone={async () => { setSetupOpen(false); await session.reloadProfile(); toast.success("Double authentification activée"); }} />}
      </Dialog>
      <SensitiveDialog mode={mode} onClose={() => setMode(null)} onCodes={setCodes} />
      <Dialog open={!!codes} onOpenChange={(o) => { if (!o) setCodes(null); }} title="Nouveaux codes de secours" description="Les anciens codes ne fonctionnent plus. Ceux-ci ne seront plus affichés." dismissable={false}
        footer={<Button variant="primary" onClick={() => setCodes(null)}>J'ai enregistré mes codes</Button>}>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-subtle p-3">
          {codes?.map((c) => <li key={c} className="rounded-md bg-background px-2 py-2 text-center font-mono text-sm shadow-xs ring-1 ring-border">{c}</li>)}
        </ul>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={async () => { if (codes && await copyText(codes.join("\n"))) toast.success("Codes copiés"); }}>Tout copier</Button>
          <Button variant="secondary" className="flex-1" onClick={() => codes && downloadText("codes-de-secours.txt", `Codes de secours — ${user.email}\n\n${codes.join("\n")}\n`)}><Download /> Télécharger</Button>
        </div>
      </Dialog>
    </SettingsSection>
  );
}

/** Désactivation / régénération : mot de passe + code de l'application exigés par l'API. */
function SensitiveDialog({ mode, onClose, onCodes }: { mode: "disable" | "regenerate" | null; onClose: () => void; onCodes: (c: string[]) => void }) {
  const session = useSession();
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setPassword(""); setCode(""); setError(null); }, [mode]);
  const run = useMutation({
    mutationFn: async () => {
      if (mode === "disable") { await session.account.disable2fa({ password, code }); return null; }
      return (await session.account.regenerateRecoveryCodes({ password, code })).recoveryCodes;
    },
    onSuccess: async (codes) => {
      await session.reloadProfile();
      onClose();
      if (codes) onCodes(codes); else toast.success("Double authentification désactivée");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open={!!mode}
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="sm"
      title={mode === "disable" ? "Désactiver la double authentification" : "Régénérer les codes de secours"}
      description="Confirmez avec votre mot de passe et un code de votre application."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button>
        <Button variant={mode === "disable" ? "danger" : "primary"} loading={run.isPending} disabled={!password || code.length < 6} onClick={() => run.mutate()}>
          {mode === "disable" ? "Désactiver" : "Régénérer"}
        </Button></>}
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (password && code.length >= 6) run.mutate(); }}>
        {error && <Callout tone="danger">{error}</Callout>}
        <Field label="Mot de passe"><PasswordInput autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Code de l'application"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function SessionsTab() {
  const session = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = [...session.queryKey, "account", "sessions"];
  const q = useQuery({ queryKey: key, queryFn: session.account.sessions });
  const revoke = useMutation({
    mutationFn: (id: string) => session.account.revokeSession(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (rows: { id: string }[] | undefined) => rows?.filter((r) => r.id !== id));
      return { prev };
    },
    onError: (e, _id, ctx) => { qc.setQueryData(key, ctx?.prev); toastError(e); },
    onSuccess: () => toast.success("Session fermée"),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const revokeOthers = useMutation({
    mutationFn: session.account.revokeOtherSessions,
    onSuccess: (r) => { toast.success(r.revoked ? `${r.revoked} session${r.revoked > 1 ? "s" : ""} fermée${r.revoked > 1 ? "s" : ""}` : "Aucune autre session"); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toastError(e),
  });
  const others = q.data?.filter((s) => !s.current).length ?? 0;
  return (
    <SettingsSection
      title="Sessions actives"
      description="Appareils connectés à votre compte. Fermez celles que vous ne reconnaissez pas."
      footer={<><span className="text-[13px] text-muted-foreground">{q.data ? `${q.data.length} session${q.data.length > 1 ? "s" : ""}` : ""}</span>
        <Button size="sm" variant="secondary" disabled={!others} loading={revokeOthers.isPending} onClick={() => confirm({
          title: "Fermer toutes les autres sessions ?", description: "Tous vos autres appareils seront déconnectés immédiatement. Cette session reste ouverte.", confirmLabel: "Fermer les autres sessions",
          onConfirm: () => revokeOthers.mutateAsync(),
        })}><LogOut /> Fermer les autres sessions</Button></>}
    >
      {q.isLoading ? <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        : q.isError ? <p className="text-sm text-danger">{errorMessage(q.error)}</p>
        : !q.data?.length ? <EmptyState icon={<MonitorSmartphone />} title="Aucune session" />
        : (
          <ul className="-mx-5 divide-y divide-border border-y border-border sm:-mx-6">
            <AnimatePresence initial={false}>
              {q.data.map((s) => {
                const d = describeUserAgent(s.userAgent);
                return (
                  <motion.li key={s.id} layout exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="flex items-center gap-4 px-5 py-3.5 sm:px-6">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle"><DeviceIcon ua={s.userAgent} /></span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">{d.label}{s.current && <Badge tone="green" dot>Cette session</Badge>}</span>
                      <span className="text-xs text-muted-foreground">
                        <span className="font-mono">{s.ip ?? "IP inconnue"}</span> · active {formatRelative(s.lastUsedAt ?? s.createdAt)} · ouverte le {formatDate(s.createdAt)}
                      </span>
                    </div>
                    {!s.current && (
                      <Button size="sm" variant="ghost" onClick={() => confirm({
                        title: "Fermer cette session ?", description: `${d.label} (${s.ip ?? "IP inconnue"}) sera déconnecté immédiatement.`, confirmLabel: "Fermer la session",
                        onConfirm: () => revoke.mutateAsync(s.id),
                      })}>Fermer</Button>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
    </SettingsSection>
  );
}

function HistoryTab() {
  const session = useSession();
  const q = useQuery({ queryKey: [...session.queryKey, "account", "history"], queryFn: session.account.loginHistory });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">Vos 50 dernières tentatives de connexion. Une tentative inconnue ? Changez votre mot de passe et activez la 2FA.</p>
      <LoginEventsTable rows={q.data} loading={q.isLoading} showEmail={false} />
    </div>
  );
}
