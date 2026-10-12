import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/lib/use-url-state";
import { brandingKeys } from "@/providers/branding";
import { BrandingEditor } from "../settings/branding-editor";
import type { SettingsAdapter } from "../settings/common";
import { BusinessForm, LocalizationForm, OperationsForm, SecurityPolicyForm } from "../settings/forms";
import { SETTINGS_READ, useTenant } from "./hooks";

const TABS = [
  { v: "informations", s: "business", l: "Informations" },
  { v: "marque", s: "branding", l: "Marque" },
  { v: "exploitation", s: "operations", l: "Exploitation" },
  { v: "localisation", s: "localization", l: "Localisation" },
  { v: "securite", s: "security", l: "Sécurité" },
] as const;

export function TenantSettingsPage() {
  const t = useTenant();
  const qc = useQueryClient();
  const visible = TABS.filter((x) => SETTINGS_READ[x.s]?.includes(t.role));
  const [tab, setTab] = useUrlParam("onglet", visible[0]?.v ?? "exploitation");
  const current = visible.some((x) => x.v === tab) ? tab : visible[0]?.v ?? "";

  const adapter = React.useMemo<SettingsAdapter>(() => ({
    key: t.key("settings"),
    get: (s) => t.api.settings.get(s as never),
    update: (s, body) => t.api.settings.update(s as never, body as never),
    uploadAsset: (k, f) => t.api.settings.uploadAsset(k, f),
    removeAsset: (k) => t.api.settings.removeAsset(k),
    canWrite: t.isAdmin,
    onSaved: (s) => {
      if (s === "branding") void qc.invalidateQueries({ queryKey: brandingKeys.tenant(t.slug) });
      void qc.invalidateQueries({ queryKey: t.key("settings", "all") });
    },
  }), [t, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title="Paramètres"
        description={t.isAdmin ? "Informations du restaurant, marque, exploitation, localisation et sécurité." : "Consultation des réglages du restaurant. Seul l'administrateur peut les modifier."}
      />
      <Tabs value={current} onValueChange={setTab}>
        <TabsList>{visible.map((x) => <TabsTrigger key={x.v} value={x.v}>{x.l}</TabsTrigger>)}</TabsList>
        {visible.some((x) => x.s === "business") && <TabsContent value="informations"><BusinessForm adapter={adapter} /></TabsContent>}
        {visible.some((x) => x.s === "branding") && <TabsContent value="marque"><BrandingEditor adapter={adapter} contextLabel="Espace restaurant" /></TabsContent>}
        <TabsContent value="exploitation"><OperationsForm adapter={adapter} /></TabsContent>
        <TabsContent value="localisation"><LocalizationForm adapter={adapter} /></TabsContent>
        {visible.some((x) => x.s === "security") && <TabsContent value="securite"><SecurityPolicyForm adapter={adapter} space="tenant" /></TabsContent>}
      </Tabs>
    </>
  );
}
