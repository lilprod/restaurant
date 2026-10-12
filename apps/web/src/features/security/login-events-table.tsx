import type { LoginEvent, LoginResult } from "@restaurant/api-client";
import { Laptop, Smartphone, Tablet, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatRelative } from "@/lib/format";
import { LOGIN_RESULT_LABEL, LOGIN_RESULT_TONE } from "@/lib/labels";
import { describeUserAgent } from "@/lib/user-agent";

export const LOGIN_RESULTS: LoginResult[] = ["SUCCESS", "BAD_PASSWORD", "UNKNOWN_ACCOUNT", "LOCKED", "TWO_FACTOR_FAILED", "TWO_FACTOR_REQUIRED", "LICENSE_BLOCKED", "ACCOUNT_DISABLED"];

export function DeviceIcon({ ua, className = "size-4 text-muted-foreground" }: { ua: string | null; className?: string }) {
  const k = describeUserAgent(ua).kind;
  return k === "mobile" ? <Smartphone className={className} /> : k === "tablet" ? <Tablet className={className} /> : <Laptop className={className} />;
}

/** Journal des connexions (date, résultat, compte, appareil, IP). */
export function LoginEventsTable({ rows, loading, showEmail = true, showSpace }: { rows?: LoginEvent[]; loading?: boolean; showEmail?: boolean; showSpace?: boolean }) {
  const columns: Column<LoginEvent>[] = [
    { key: "date", header: "Date", cell: (e) => <span className="whitespace-nowrap font-mono text-xs tabular" title={formatRelative(e.createdAt)}>{formatDateTime(e.createdAt)}</span> },
    { key: "result", header: "Résultat", cell: (e) => <Badge tone={LOGIN_RESULT_TONE[e.result] ?? "gray"} dot>{LOGIN_RESULT_LABEL[e.result] ?? e.result}</Badge> },
    ...(showEmail ? [{ key: "email", header: "Compte", cell: (e: LoginEvent) => <span className="block max-w-[220px] truncate">{e.email}</span> }] : []),
    ...(showSpace ? [{ key: "space", header: "Espace", hideOnMobile: true, cell: (e: LoginEvent) => <span className="text-muted-foreground">{e.space === "platform" ? "Plateforme" : "Restaurant"}</span> }] : []),
    { key: "device", header: "Appareil", hideOnMobile: true, cell: (e) => <span className="flex items-center gap-2 text-muted-foreground"><DeviceIcon ua={e.userAgent} /> {describeUserAgent(e.userAgent).label}</span> },
    { key: "ip", header: "IP", align: "right", cell: (e) => <span className="font-mono text-xs text-muted-foreground">{e.ip ?? "—"}</span> },
  ];
  return (
    <DataTable
      caption="Journal des connexions"
      rows={rows}
      loading={loading}
      columns={columns}
      rowKey={(e) => e.id}
      mobileCard={(e) => (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Badge tone={LOGIN_RESULT_TONE[e.result] ?? "gray"} dot>{LOGIN_RESULT_LABEL[e.result] ?? e.result}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
          </div>
          {showEmail && <p className="truncate text-sm">{e.email}</p>}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><DeviceIcon ua={e.userAgent} className="size-3.5" /> {describeUserAgent(e.userAgent).label} · <span className="font-mono">{e.ip ?? "—"}</span></p>
        </div>
      )}
      empty={<EmptyState icon={<History />} title="Aucune connexion" description="Les tentatives de connexion apparaîtront ici." />}
    />
  );
}
