import { Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationsLog } from "../../notifications/notifications-log";
import { papi, useCanWrite } from "../hooks";
import { TenantPicker } from "../payments/tenant-picker";

/** Journal global des messages (plateforme + restaurants), filtrable par restaurant, avec renvoi pour le SuperAdmin. */
export function NotificationsPage() {
  const canWrite = useCanWrite();
  return (
    <>
      <PageHeader title="Notifications" description="Emails et SMS envoyés par la plateforme et par les restaurants. Les destinataires sont masqués." />
      <NotificationsLog
        api={papi.notifications}
        queryRoot={["platform"]}
        canResend={canWrite}
        showTenant
        extraFilter={({ tenantId, setTenantId }) => (
          <Field label="Restaurant"><TenantPicker value={tenantId} onChange={setTenantId} placeholder="Tous les restaurants" allowClear /></Field>
        )}
      />
    </>
  );
}
