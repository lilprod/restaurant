import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, MoreHorizontal, RefreshCw, ShieldOff, Unlock, UserCheck, UserX, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown";
import { EmptyState } from "@/components/ui/empty-state";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { TempPasswordDialog } from "./temp-password-dialog";

export type UserAction = "reset-password" | "unlock" | "disable-2fa" | "revoke-sessions";

export interface SecurityUser {
  id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean;
  twoFactorEnabled: boolean; locked: boolean; lastLoginAt: string | null; mustChangePassword?: boolean;
}

export interface UsersAdapter<U extends SecurityUser> {
  key: readonly unknown[];
  list: () => Promise<U[]>;
  action: (id: string, action: UserAction) => Promise<{ temporaryPassword?: string; revoked?: number }>;
  setActive?: (id: string, isActive: boolean) => Promise<unknown>;
  canWrite: boolean;
  roleLabels: Record<string, string>;
  currentUserId?: string;
  /** Actions supplémentaires (changement de rôle…), insérées en tête du menu. */
  extraActions?: (u: U) => React.ReactNode;
}

/** Utilisateurs avec leur état de sécurité et les actions d'administration (toujours confirmées). */
export function UsersSecurityTable<U extends SecurityUser>({ adapter, emptyAction }: { adapter: UsersAdapter<U>; emptyAction?: React.ReactNode }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const users = useQuery({ queryKey: adapter.key, queryFn: adapter.list });
  const [temp, setTemp] = React.useState<{ value: string; who: string } | null>(null);

  const run = useMutation({
    mutationFn: ({ u, action }: { u: U; action: UserAction }) => adapter.action(u.id, action),
    onSuccess: (r, { u, action }) => {
      void qc.invalidateQueries({ queryKey: adapter.key });
      if (action === "reset-password" && r.temporaryPassword) setTemp({ value: r.temporaryPassword, who: `${u.firstName} ${u.lastName}` });
      else toast.success(
        action === "unlock" ? "Compte déverrouillé" :
        action === "disable-2fa" ? "Double authentification retirée" :
        `Sessions fermées${typeof r.revoked === "number" ? ` (${r.revoked})` : ""}`,
      );
    },
    onError: (e) => toastError(e),
  });

  const active = useMutation({
    mutationFn: ({ u, value }: { u: U; value: boolean }) => adapter.setActive!(u.id, value),
    onMutate: async ({ u, value }) => {
      // Optimiste : la ligne change tout de suite, restaurée en cas d'erreur.
      await qc.cancelQueries({ queryKey: adapter.key });
      const prev = qc.getQueryData<U[]>(adapter.key);
      qc.setQueryData<U[]>(adapter.key, (rows) => rows?.map((r) => (r.id === u.id ? { ...r, isActive: value } : r)));
      return { prev };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(adapter.key, ctx.prev); toastError(e); },
    onSuccess: (_r, { value }) => toast.success(value ? "Compte réactivé" : "Compte désactivé"),
    onSettled: () => void qc.invalidateQueries({ queryKey: adapter.key }),
  });

  const name = (u: U) => `${u.firstName} ${u.lastName}`;
  const ask = (u: U, action: UserAction) => {
    const texts: Record<UserAction, { title: string; description: string; confirmLabel: string; tone: "danger" | "primary" }> = {
      "reset-password": { title: `Réinitialiser le mot de passe de ${name(u)} ?`, description: "Un mot de passe temporaire sera généré et affiché une seule fois. Ses sessions ouvertes seront fermées.", confirmLabel: "Réinitialiser", tone: "danger" },
      unlock: { title: `Déverrouiller ${name(u)} ?`, description: "Le compteur de tentatives est remis à zéro ; la connexion redevient possible immédiatement.", confirmLabel: "Déverrouiller", tone: "primary" },
      "disable-2fa": { title: `Retirer la 2FA de ${name(u)} ?`, description: "À utiliser en cas de téléphone perdu. Ses codes de secours seront invalidés et ses sessions fermées ; il pourra la réactiver.", confirmLabel: "Retirer la 2FA", tone: "danger" },
      "revoke-sessions": { title: `Fermer les sessions de ${name(u)} ?`, description: "Tous ses appareils seront déconnectés immédiatement.", confirmLabel: "Fermer les sessions", tone: "danger" },
    };
    confirm({ ...texts[action], onConfirm: () => run.mutateAsync({ u, action }) });
  };

  const columns: Column<U>[] = [
    {
      key: "user", header: "Utilisateur",
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar firstName={u.firstName} lastName={u.lastName} size={32} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{name(u)}{u.id === adapter.currentUserId && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(vous)</span>}</span>
            <span className="truncate text-xs text-muted-foreground">{u.email}</span>
          </div>
        </div>
      ),
    },
    { key: "role", header: "Rôle", cell: (u) => <Badge tone="outline">{adapter.roleLabels[u.role] ?? u.role}</Badge> },
    { key: "state", header: "État", cell: (u) => <UserStateBadges u={u} /> },
    {
      key: "last", header: "Dernière connexion", align: "right",
      cell: (u) => u.lastLoginAt ? <span className="text-[13px] text-muted-foreground" title={formatDateTime(u.lastLoginAt)}>{formatRelative(u.lastLoginAt)}</span> : <span className="text-[13px] text-faint">Jamais</span>,
    },
  ];

  return (
    <>
      {users.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-10 text-center">
          <p className="text-sm">{errorMessage(users.error)}</p>
          <Button variant="secondary" size="sm" onClick={() => users.refetch()}><RefreshCw /> Réessayer</Button>
        </div>
      ) : (
        <DataTable
          caption="Utilisateurs"
          rows={users.data}
          loading={users.isLoading}
          columns={columns}
          rowKey={(u) => u.id}
          mobileCard={(u) => (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Avatar firstName={u.firstName} lastName={u.lastName} size={32} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{name(u)}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="outline">{adapter.roleLabels[u.role] ?? u.role}</Badge>
                <UserStateBadges u={u} />
              </div>
              <p className="text-xs text-muted-foreground">Dernière connexion : {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "jamais"}</p>
            </div>
          )}
          rowActions={adapter.canWrite ? (u) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Actions pour ${name(u)}`}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {adapter.extraActions?.(u)}
                <DropdownMenuItem onSelect={() => ask(u, "reset-password")}><KeyRound /> Réinitialiser le mot de passe</DropdownMenuItem>
                {u.locked && <DropdownMenuItem onSelect={() => ask(u, "unlock")}><Unlock /> Déverrouiller</DropdownMenuItem>}
                {u.twoFactorEnabled && <DropdownMenuItem onSelect={() => ask(u, "disable-2fa")}><ShieldOff /> Retirer la 2FA</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => ask(u, "revoke-sessions")}><LogOut /> Fermer les sessions</DropdownMenuItem>
                {adapter.setActive && u.id !== adapter.currentUserId && (
                  <>
                    <DropdownMenuSeparator />
                    {u.isActive ? (
                      <DropdownMenuItem destructive onSelect={() => confirm({
                        title: `Désactiver le compte de ${name(u)} ?`,
                        description: "Il ne pourra plus se connecter et ses sessions seront fermées. Vous pourrez le réactiver à tout moment.",
                        confirmLabel: "Désactiver",
                        onConfirm: () => active.mutateAsync({ u, value: false }),
                      })}><UserX /> Désactiver le compte</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => active.mutate({ u, value: true })}><UserCheck /> Réactiver le compte</DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined}
          empty={<EmptyState icon={<Users />} title="Aucun utilisateur" description="Aucun compte n'est encore rattaché." action={emptyAction} />}
        />
      )}
      <TempPasswordDialog value={temp?.value ?? null} who={temp?.who} onClose={() => setTemp(null)} />
    </>
  );
}

function UserStateBadges({ u }: { u: SecurityUser }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!u.isActive ? <Badge tone="gray" dot>Désactivé</Badge> : u.locked ? <Badge tone="red" dot>Verrouillé</Badge> : <Badge tone="green" dot>Actif</Badge>}
      <Badge tone={u.twoFactorEnabled ? "blue" : "outline"}>{u.twoFactorEnabled ? "2FA" : "Sans 2FA"}</Badge>
      {u.mustChangePassword && <Badge tone="amber">Mot de passe à changer</Badge>}
    </div>
  );
}
