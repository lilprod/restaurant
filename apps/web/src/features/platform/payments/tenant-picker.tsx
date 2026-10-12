import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import * as React from "react";
import { StatusBadge } from "@/components/ui/badge";
import { inputClass } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { TENANT_STATUS_LABEL } from "@/lib/labels";
import { papi } from "../hooks";

/** Sélecteur de restaurant avec recherche côté serveur (nom, slug, email). */
export function TenantPicker({ value, onChange, id, placeholder = "Choisir un restaurant…", allowClear, ...aria }: {
  value?: string; onChange: (id: string) => void; id?: string; placeholder?: string; allowClear?: boolean; "aria-invalid"?: boolean; "aria-describedby"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);

  const list = useQuery({
    queryKey: ["platform", "tenant-picker", debounced],
    queryFn: () => papi.tenants.list({ search: debounced || undefined, pageSize: 20 }),
    enabled: open,
    placeholderData: (p) => p,
  });
  const selected = useQuery({
    queryKey: ["platform", "tenant", value ?? ""],
    queryFn: () => papi.tenants.get(value!),
    enabled: !!value,
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button id={id} type="button" role="combobox" aria-expanded={open} {...aria} className={cn(inputClass, "items-center justify-between gap-2 text-left")}>
          <span className={cn("truncate", !value && "text-faint")}>
            {value ? selected.data ? <>{selected.data.name} <span className="font-mono text-xs text-muted-foreground">{selected.data.slug}</span></> : "…" : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[60] w-[var(--radix-popover-trigger-width)] min-w-[280px] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
          <Command shouldFilter={false} label="Restaurants">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input value={q} onValueChange={setQ} placeholder="Rechercher par nom, slug, email…" className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-faint" />
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">{list.isFetching ? "Recherche…" : "Aucun restaurant"}</Command.Empty>
              {allowClear && value && (
                <Command.Item value="__clear" onSelect={() => { onChange(""); setOpen(false); }} className="flex min-h-10 cursor-pointer items-center rounded-md px-2.5 text-sm text-muted-foreground data-[selected=true]:bg-hover">
                  Tous les restaurants
                </Command.Item>
              )}
              {list.data?.items.map((t) => (
                <Command.Item key={t.id} value={t.id} onSelect={() => { onChange(t.id); setOpen(false); }} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2.5 text-sm data-[selected=true]:bg-hover">
                  <Check className={cn("size-4", value === t.id ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{t.name} <span className="font-mono text-xs text-muted-foreground">{t.slug}</span></span>
                  <StatusBadge status={t.status} labels={TENANT_STATUS_LABEL} />
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
