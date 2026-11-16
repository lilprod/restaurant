import { Tablet } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlParam } from "@/lib/use-url-state";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";
import { AbsencesTab } from "./absences-tab";
import { AttendanceTab } from "./attendance-tab";
import { useMyAttendance } from "./hr-hooks";
import { ModuleLocked } from "./module-locked";
import { PayrollTab } from "./payroll-tab";
import { PerformanceTab } from "./performance-tab";
import { PlanningTab } from "./planning-tab";
import { ProfilesTab } from "./profiles-tab";

/** Personnel (responsables) : planning, pointages, absences, fiches, performances, paie (administrateur). */
export function PersonnelPage() {
  const t = useTenant();
  const to = useSpacePath();
  const probe = useMyAttendance();
  const [tab, setTab] = useUrlParam("onglet", "planning");
  if (!probe.moduleEnabled) return <><PageHeader title="Personnel" /><ModuleLocked /></>;
  return (
    <>
      <PageHeader
        title="Personnel"
        description="Planning de la semaine, pointages, absences, fiches du personnel et performances."
        actions={<Button asChild variant="secondary"><Link to={to("/pointage/tablette")}><Tablet /> Mode tablette</Link></Button>}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v === "planning" ? null : v)}>
        <TabsList>
          <TabsTrigger value="planning">Planning</TabsTrigger>
          <TabsTrigger value="pointages">Pointages</TabsTrigger>
          <TabsTrigger value="absences">Absences</TabsTrigger>
          <TabsTrigger value="fiches">Fiches</TabsTrigger>
          <TabsTrigger value="performances">Performances</TabsTrigger>
          {t.isAdmin && <TabsTrigger value="paie">Paie</TabsTrigger>}
        </TabsList>
        <TabsContent value="planning" className="pt-5"><PlanningTab /></TabsContent>
        <TabsContent value="pointages" className="pt-5"><AttendanceTab /></TabsContent>
        <TabsContent value="absences" className="pt-5"><AbsencesTab /></TabsContent>
        <TabsContent value="fiches" className="pt-5"><ProfilesTab /></TabsContent>
        <TabsContent value="performances" className="pt-5"><PerformanceTab /></TabsContent>
        {t.isAdmin && <TabsContent value="paie" className="pt-5"><PayrollTab /></TabsContent>}
      </Tabs>
    </>
  );
}
