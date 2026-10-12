import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/lib/use-url-state";
import { brandingKeys } from "@/providers/branding";
import { useSession } from "@/providers/session";
import { BrandingEditor } from "../../settings/branding-editor";
import type { SettingsAdapter } from "../../settings/common";
import { CompanyForm, LicensingForm, LocalizationForm, PaymentInstructionsForm, SecurityPolicyForm } from "../../settings/forms";
import { papi, pk, useCanWrite } from "../hooks";

export function PlatformSettingsPage() {
  const canWrite = useCanWrite();
  const { user } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useUrlParam("onglet", "marque");

  const adapter = React.useMemo<SettingsAdapter>(() => ({
    key: pk.settings,
    get: (s) => papi.settings.get(s as never),
    update: (s, body) => papi.settings.update(s as never, body as never),
    uploadAsset: (k, f) => papi.settings.uploadAsset(k, f),
    removeAsset: (k) => papi.settings.removeAsset(k),
    canWrite,
    onSaved: (s) => { if (s === "branding" || s === "company") void qc.invalidateQueries({ queryKey: brandingKeys.platform }); },
  }), [canWrite, qc]);

  const tabs = [
    { v: "marque", l: "Marque" },
    { v: "societe", l: "Société" },
    { v: "localisation", l: "Localisation" },
    ...(user?.role === "SUPER_ADMIN" ? [{ v: "securite", l: "Sécurité" }] : []),
    { v: "paiement", l: "Instructions de paiement" },
    { v: "licences", l: "Licences" },
  ];

  return (
    <>
      <PageHeader title="Paramètres" description="Marque de la plateforme, société éditrice, sécurité de l'équipe et règles de licence." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>{tabs.map((t) => <TabsTrigger key={t.v} value={t.v}>{t.l}</TabsTrigger>)}</TabsList>
        <TabsContent value="marque"><BrandingEditor adapter={adapter} contextLabel="Administration de la plateforme" /></TabsContent>
        <TabsContent value="societe"><CompanyForm adapter={adapter} /></TabsContent>
        <TabsContent value="localisation"><LocalizationForm adapter={adapter} /></TabsContent>
        {user?.role === "SUPER_ADMIN" && <TabsContent value="securite"><SecurityPolicyForm adapter={adapter} space="platform" /></TabsContent>}
        <TabsContent value="paiement"><PaymentInstructionsForm adapter={adapter} /></TabsContent>
        <TabsContent value="licences"><LicensingForm adapter={adapter} /></TabsContent>
      </Tabs>
    </>
  );
}
