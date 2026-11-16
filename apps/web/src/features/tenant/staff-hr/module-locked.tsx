import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useSpacePath } from "@/providers/space";
import { useTenant } from "../hooks";

/** Plan sans le module Personnel (`403 PLAN_FEATURE`). */
export function ModuleLocked() {
  const t = useTenant();
  const to = useSpacePath();
  return (
    <EmptyState
      icon={<Lock />}
      title="Le module Personnel n'est pas inclus dans votre plan"
      description="Planning, pointage, absences, performances et paie sont disponibles à partir du plan Pro. La messagerie reste ouverte à tous."
      action={t.canSeeLicense ? <Button asChild variant="primary"><Link to={to("/licence")}>Voir les plans</Link></Button> : undefined}
    />
  );
}
