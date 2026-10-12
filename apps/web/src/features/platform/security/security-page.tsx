import type { LoginResult } from "@restaurant/api-client";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { errorMessage } from "@/lib/errors";
import { LOGIN_RESULT_LABEL } from "@/lib/labels";
import { useUrlParam } from "@/lib/use-url-state";
import { LOGIN_RESULTS, LoginEventsTable } from "../../security/login-events-table";
import { papi, pk } from "../hooks";

export function PlatformSecurityPage() {
  const [result, setResult] = useUrlParam("resultat");
  const [space, setSpace] = useUrlParam("espace");
  const q = useQuery({
    queryKey: [...pk.events(result), space],
    queryFn: () => papi.security.loginEvents({ limit: 200, result: (result || undefined) as LoginResult | undefined, space: (space || undefined) as "platform" | "tenant" | undefined }),
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader title="Sécurité" description="Journal des connexions de toute la plateforme : repérez les attaques par mot de passe et les comptes verrouillés."
        actions={<Button variant="secondary" onClick={() => q.refetch()} loading={q.isFetching && !q.isLoading}><RefreshCw /> Actualiser</Button>} />
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
          <Segmented ariaLabel="Résultat" size="sm" value={result} onChange={setResult} className="w-auto min-w-max"
            options={[{ value: "", label: "Tous" }, ...LOGIN_RESULTS.map((r) => ({ value: r, label: LOGIN_RESULT_LABEL[r]! }))]} />
        </div>
        <Segmented ariaLabel="Espace" size="sm" value={space} onChange={setSpace} className="w-auto"
          options={[{ value: "", label: "Tous les espaces" }, { value: "platform", label: "Plateforme" }, { value: "tenant", label: "Restaurants" }]} />
      </div>
      {q.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-10"><p className="text-sm">{errorMessage(q.error)}</p><Button size="sm" variant="secondary" onClick={() => q.refetch()}><RefreshCw /> Réessayer</Button></div>
      ) : <LoginEventsTable rows={q.data} loading={q.isLoading} showSpace />}
    </>
  );
}
