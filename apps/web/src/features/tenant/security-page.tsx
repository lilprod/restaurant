import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TENANT_ROLE_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";
import { useSession } from "@/providers/session";
import { useSpacePath } from "@/providers/space";
import { LoginEventsTable } from "../security/login-events-table";
import { UsersSecurityTable } from "../security/users-security-table";
import { useTenant } from "./hooks";

export function TenantSecurityPage() {
  const t = useTenant();
  const { user } = useSession();
  const to = useSpacePath();
  const [tab, setTab] = useUrlParam("onglet", "utilisateurs");
  const events = useQuery({ queryKey: t.key("security", "events"), queryFn: () => t.api.security.loginEvents({ limit: 100 }), enabled: t.isAdmin && tab === "connexions" });
  if (!t.isAdmin) return <Navigate to={to("/")} replace />;
  return (
    <>
      <PageHeader title="Sécurité" description="Sécurité des comptes de votre équipe et journal des connexions. Les membres se créent depuis l’écran Équipe." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="utilisateurs">Utilisateurs</TabsTrigger>
          <TabsTrigger value="connexions">Connexions</TabsTrigger>
        </TabsList>
        <TabsContent value="utilisateurs">
          <UsersSecurityTable adapter={{
            key: t.key("security", "users"),
            list: t.api.security.users,
            action: (id, a) => t.api.security.userAction(id, a),
            setActive: (id, v) => t.api.security.setActive(id, v),
            canWrite: true,
            roleLabels: TENANT_ROLE_LABEL,
            currentUserId: user?.id,
          }} />
        </TabsContent>
        <TabsContent value="connexions"><LoginEventsTable rows={events.data} loading={events.isLoading} /></TabsContent>
      </Tabs>
    </>
  );
}
