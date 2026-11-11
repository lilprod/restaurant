import { PageHeader } from "@/components/ui/page-header";
import { NotificationsLog } from "../notifications/notifications-log";
import { useTenant } from "./hooks";

/** Journal des messages du restaurant (administrateur) : relances, mots de passe oubliés, avec renvoi manuel. */
export function TenantNotificationsPage() {
  const t = useTenant();
  return (
    <>
      <PageHeader title="Notifications" description="Emails et SMS envoyés par votre restaurant. Les destinataires sont masqués." />
      <NotificationsLog api={t.api.notifications} queryRoot={t.key("notifications-log")} canResend={t.isAdmin} />
    </>
  );
}
