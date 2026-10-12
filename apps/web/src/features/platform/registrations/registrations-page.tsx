import type { Registration } from "@restaurant/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, Inbox, Mail, Phone, RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PlanPicker } from "@/components/plan-picker";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDateTime, formatRelative } from "@/lib/format";
import { REGISTRATION_STATUS_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";
import { papi, pk, useCanWrite } from "../hooks";

const TABS = [
  { v: "PENDING", l: "En attente" },
  { v: "APPROVED", l: "Validées" },
  { v: "REJECTED", l: "Rejetées" },
] as const;

export function RegistrationsPage() {
  const [tab, setTab] = useUrlParam("statut", "PENDING");
  const all = useQuery({ queryKey: pk.registrations(), queryFn: () => papi.registrations.list() });
  const plans = useQuery({ queryKey: pk.plans, queryFn: papi.plans.list });
  const [approving, setApproving] = React.useState<Registration | null>(null);
  const byStatus = (s: string) => all.data?.filter((r) => r.status === s) ?? [];

  return (
    <>
      <PageHeader title="Inscriptions" description="Demandes envoyées depuis le formulaire public. Valider crée le restaurant, son administrateur et l'essai gratuit." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map((t) => <TabsTrigger key={t.v} value={t.v} count={all.data ? byStatus(t.v).length : undefined}>{t.l}</TabsTrigger>)}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.v} value={t.v}>
            {all.isLoading ? (
              <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}</div>
            ) : all.isError ? (
              <div className="flex flex-col items-center gap-3 py-10"><p className="text-sm">{errorMessage(all.error)}</p><Button size="sm" variant="secondary" onClick={() => all.refetch()}><RefreshCw /> Réessayer</Button></div>
            ) : byStatus(t.v).length === 0 ? (
              <EmptyState
                icon={<Inbox />}
                title={t.v === "PENDING" ? "Aucune demande en attente" : t.v === "APPROVED" ? "Aucune inscription validée" : "Aucune inscription rejetée"}
                description={t.v === "PENDING" ? "Partagez le formulaire public pour recevoir de nouvelles demandes." : undefined}
                action={t.v === "PENDING" ? <Button asChild variant="secondary"><a href="/inscription" target="_blank" rel="noreferrer">Ouvrir le formulaire <ArrowUpRight /></a></Button> : undefined}
              />
            ) : (
              <motion.ul layout className="grid gap-4 md:grid-cols-2">
                <AnimatePresence initial={false}>
                  {byStatus(t.v).map((r, i) => (
                    <motion.li key={r.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03 } }} exit={{ opacity: 0, scale: 0.97 }}>
                      <RegistrationCard r={r} planName={plans.data?.find((p) => p.id === r.planId)?.name} onApprove={() => setApproving(r)} />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <ApproveDialog registration={approving} onClose={() => setApproving(null)} />
    </>
  );
}

function RegistrationCard({ r, planName, onApprove }: { r: Registration; planName?: string; onApprove: () => void }) {
  const canWrite = useCanWrite();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const reject = useMutation({
    mutationFn: (reason: string) => papi.registrations.reject(r.id, reason),
    onSuccess: () => { toast.success("Inscription rejetée"); void qc.invalidateQueries({ queryKey: pk.registrations() }); void qc.invalidateQueries({ queryKey: pk.dashboard }); },
    onError: (e) => toastError(e),
  });
  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[15px] font-semibold">{r.restaurantName}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{r.slug}.monapp.com</span>
        </div>
        <StatusBadge status={r.status} labels={REGISTRATION_STATUS_LABEL} />
      </div>
      <div className="flex flex-col gap-2.5 px-5 pb-4 text-sm">
        <div className="flex items-center gap-2.5">
          <Avatar firstName={r.ownerFirstName} lastName={r.ownerLastName} size={24} />
          <span className="truncate">{r.ownerFirstName} {r.ownerLastName}</span>
        </div>
        <a href={`mailto:${r.email}`} className="flex items-center gap-2.5 truncate text-muted-foreground hover:text-foreground"><Mail className="size-4 shrink-0" /> {r.email}</a>
        {r.phone && <a href={`tel:${r.phone}`} className="flex items-center gap-2.5 text-muted-foreground hover:text-foreground"><Phone className="size-4 shrink-0" /> <span className="font-mono text-[13px]">{r.phone}</span></a>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <span>Plan demandé : <span className="text-foreground">{planName ?? "aucun (premier plan actif)"}</span></span>
          <span title={formatDateTime(r.createdAt)}>Reçue {formatRelative(r.createdAt)}</span>
        </div>
        {r.status === "REJECTED" && r.rejectionReason && (
          <p className="rounded-md border border-border bg-subtle px-3 py-2 text-[13px]"><span className="text-muted-foreground">Motif : </span>{r.rejectionReason}</p>
        )}
      </div>
      <div className="mt-auto flex items-center justify-end gap-2 border-t border-border bg-subtle px-5 py-3 rounded-b-lg">
        {r.status === "PENDING" && canWrite ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => confirm({
              title: `Rejeter la demande de ${r.restaurantName} ?`,
              description: "Le motif est conservé dans l'historique. Aucun restaurant ne sera créé.",
              confirmLabel: "Rejeter",
              reason: { label: "Motif du rejet", placeholder: "Informations incomplètes, doublon…" },
              onConfirm: (reason) => reject.mutateAsync(reason!),
            })}><X /> Rejeter</Button>
            <Button size="sm" variant="primary" onClick={onApprove}><Check /> Valider l'inscription</Button>
          </>
        ) : r.status === "APPROVED" && r.tenantId ? (
          <Button asChild size="sm" variant="secondary"><Link to={`/admin/restaurants/${r.tenantId}`}>Voir le restaurant <ArrowUpRight /></Link></Button>
        ) : (
          <span className="text-xs text-muted-foreground">{r.reviewedAt ? `Traitée ${formatRelative(r.reviewedAt)}` : "En attente de validation"}</span>
        )}
      </div>
    </Card>
  );
}

function ApproveDialog({ registration: r, onClose }: { registration: Registration | null; onClose: () => void }) {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: pk.plans, queryFn: papi.plans.list, enabled: !!r });
  const [planId, setPlanId] = React.useState<string | undefined>();
  React.useEffect(() => { setPlanId(r?.planId ?? plans.data?.find((p) => p.isActive)?.id); }, [r, plans.data]);
  const approve = useMutation({
    mutationFn: () => papi.registrations.approve(r!.id, planId),
    onSuccess: (res) => {
      toast.success(`${r?.restaurantName} est validé`, { description: `Essai démarré · ${res.slug}`, action: { label: "Ouvrir", onClick: () => window.location.assign(`/admin/restaurants/${res.tenantId}`) } });
      void qc.invalidateQueries({ queryKey: pk.registrations() });
      void qc.invalidateQueries({ queryKey: pk.tenantsAll });
      void qc.invalidateQueries({ queryKey: pk.dashboard });
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const active = plans.data?.filter((p) => p.isActive) ?? [];
  return (
    <Dialog
      open={!!r}
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="lg"
      title={`Valider ${r?.restaurantName ?? ""}`}
      description="Le restaurant, son administrateur (avec le mot de passe choisi à l'inscription) et l'essai gratuit sont créés en une seule opération."
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={approve.isPending} onClick={() => approve.mutate()}><Check /> Valider l'inscription</Button></>}
    >
      <div className="flex flex-col gap-3">
        <span className="text-[13px] font-medium">Plan attribué</span>
        {plans.isLoading ? <Skeleton className="h-24" /> : <PlanPicker plans={active} value={planId} onChange={setPlanId} compact />}
        {r?.planId && planId !== r.planId && <p className="text-[13px] text-muted-foreground">Le plan diffère de celui demandé par le restaurant.</p>}
      </div>
    </Dialog>
  );
}
