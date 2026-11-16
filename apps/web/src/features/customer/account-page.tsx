import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, LogOut, MailCheck, Star, UserRound } from "lucide-react";
import * as React from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { FullScreenLoader } from "@/features/auth/require-session";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { OtpInput } from "@/components/ui/otp-input";
import { Segmented } from "@/components/ui/segmented";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage, toastError } from "@/lib/errors";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { PublicShell } from "../public-reservation/shared";
import { LoginForm, SignupForm } from "./auth-forms";
import { useCustomer } from "./hooks";
import { OrdersTab } from "./orders-tab";
import { ProfileTab } from "./profile-tab";
import { ReservationsTab } from "./reservations-tab";

/**
 * Espace client (`/r/:slug/compte`) : connexion et inscription, puis réservations, commandes et avis, profil.
 * Un membre du personnel qui arrive ici est redirigé vers son propre compte.
 */
export function CustomerAccountPage() {
  const session = useSession();
  const to = useSpacePath();
  const location = useLocation();
  if (session.status === "loading") return <FullScreenLoader />;
  if (session.status === "authenticated" && session.user && session.user.role !== "CUSTOMER") return <Navigate to={to("/mon-compte") + location.search} replace />;
  if (session.status === "authenticated" && session.user) return <Space />;
  return <Welcome />;
}

function Welcome() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "inscription" ? "signup" : "login";
  return (
    <PublicShell title="Mon compte">
      <div className="flex flex-col gap-6" data-testid="customer-welcome">
        <div className="flex flex-col gap-2">
          <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight">{mode === "signup" ? "Créer mon compte" : "Mon compte"}</h1>
          <p className="text-[15px] text-muted-foreground">Retrouvez vos réservations, suivez vos commandes et donnez votre avis.</p>
        </div>
        <Segmented ariaLabel="Connexion ou inscription" value={mode} onChange={(v) => setParams(v === "signup" ? { mode: "inscription" } : {}, { replace: true })}
          options={[{ value: "login", label: "Connexion" }, { value: "signup", label: "Créer un compte" }]} />
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          {mode === "login" ? <LoginForm onDone={() => undefined} /> : <SignupForm onDone={() => undefined} />}
        </div>
      </div>
    </PublicShell>
  );
}

const TABS = ["reservations", "avis", "profil"] as const;
type Tab = (typeof TABS)[number];

function Space() {
  const session = useSession();
  const c = useCustomer();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get("onglet") ?? "") ? (params.get("onglet") as Tab) : "reservations";
  const profile = useQuery({ queryKey: c.key("profile"), queryFn: () => c.api.profile() });
  const reservations = useQuery({ queryKey: c.key("reservations"), queryFn: () => c.api.reservations() });
  const upcoming = reservations.data?.filter((r) => ["PENDING", "CONFIRMED"].includes(r.status) && new Date(r.endsAt).getTime() > Date.now()).length ?? 0;
  return (
    <PublicShell title="Mon compte" actions={
      <Button variant="ghost" size="sm" onClick={() => void session.logout()} aria-label="Se déconnecter"><LogOut /> <span className="hidden sm:inline">Se déconnecter</span></Button>
    }>
      <div className="flex flex-col gap-6" data-testid="customer-space">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">Mon espace</p>
          <h1 className="font-brand text-[28px] font-semibold leading-tight tracking-tight">Bonjour {session.user?.firstName}</h1>
        </div>
        {profile.data && !profile.data.emailVerified && <VerifyEmail />}
        <Tabs value={tab} onValueChange={(v) => setParams(v === "reservations" ? {} : { onglet: v }, { replace: true })}>
          <TabsList>
            <TabsTrigger value="reservations" count={upcoming || undefined}><CalendarDays className="size-4" /> Réservations</TabsTrigger>
            <TabsTrigger value="avis"><Star className="size-4" /> Commandes et avis</TabsTrigger>
            <TabsTrigger value="profil"><UserRound className="size-4" /> Profil</TabsTrigger>
          </TabsList>
          <TabsContent value="reservations" className="pt-5"><ReservationsTab /></TabsContent>
          <TabsContent value="avis" className="pt-5"><OrdersTab /></TabsContent>
          <TabsContent value="profil" className="pt-5"><ProfileTab /></TabsContent>
        </Tabs>
      </div>
    </PublicShell>
  );
}

/** Confirmation de l'email par code à 6 chiffres : rattache les réservations faites avec cette adresse. */
function VerifyEmail() {
  const c = useCustomer();
  const qc = useQueryClient();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [asked, setAsked] = React.useState(false);
  const verify = useMutation({
    mutationFn: (v: string) => c.api.verifyEmail(v),
    onSuccess: (r) => {
      toast.success(r.reservationsLinked ? `Email vérifié : ${r.reservationsLinked} réservation${r.reservationsLinked > 1 ? "s" : ""} retrouvée${r.reservationsLinked > 1 ? "s" : ""}` : "Email vérifié");
      void qc.invalidateQueries({ queryKey: c.key() });
    },
    onError: (e) => { setError(errorMessage(e)); setCode(""); },
  });
  const send = useMutation({ mutationFn: () => c.api.sendVerification(), onSuccess: () => { setAsked(true); toast.success("Code envoyé par email"); }, onError: (e) => toastError(e) });
  return (
    <Callout tone="warning" title="Vérifiez votre email">
      <div className="flex flex-col gap-3 pt-1">
        <p>Saisissez le code à 6 chiffres reçu par email pour retrouver vos réservations passées avec cette adresse.</p>
        <OtpInput value={code} onChange={(v) => { setCode(v); setError(null); }} onComplete={(v) => verify.mutate(v)} disabled={verify.isPending} invalid={!!error} />
        {error && <p role="alert" className="text-[13px]">{error}</p>}
        <Button variant="secondary" size="sm" className="w-fit" onClick={() => send.mutate()} loading={send.isPending}><MailCheck /> {asked ? "Renvoyer le code" : "Recevoir un nouveau code"}</Button>
      </div>
    </Callout>
  );
}
