import { Command } from "cmdk";
import { CornerDownLeft, LogOut, Monitor, Moon, Search, Store, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Kbd } from "@/components/ui/kbd";
import { StatusBadge } from "@/components/ui/badge";
import { TENANT_STATUS_LABEL } from "@/lib/labels";
import { useSession } from "@/providers/session";
import { useTheme } from "@/providers/theme";

export interface CommandEntry {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  keywords?: string[];
  run: () => void;
}

export interface TenantSearchResult { id: string; name: string; slug: string; status: string }

interface PaletteProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  navigation: CommandEntry[];
  actions?: CommandEntry[];
  /** Recherche distante de restaurants (espace plateforme). */
  searchTenants?: (q: string) => Promise<TenantSearchResult[]>;
  onTenant?: (t: TenantSearchResult) => void;
}

/** Palette de commandes (⌘K / Ctrl+K) : navigation, actions rapides, recherche de restaurants, thème. */
export function CommandPalette({ open, onOpenChange, navigation, actions = [], searchTenants, onTenant }: PaletteProps) {
  const [query, setQuery] = React.useState("");
  const [tenants, setTenants] = React.useState<TenantSearchResult[]>([]);
  const [searching, setSearching] = React.useState(false);
  const { setPreference } = useTheme();
  const session = useSession();

  React.useEffect(() => { if (!open) { setQuery(""); setTenants([]); } }, [open]);

  React.useEffect(() => {
    if (!searchTenants || query.trim().length < 2) { setTenants([]); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(() => {
      searchTenants(query.trim())
        .then((r) => { if (!cancelled) setTenants(r); })
        .catch(() => undefined)
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, searchTenants]);

  const run = (fn: () => void) => { onOpenChange(false); setTimeout(fn, 0); };

  const item = "flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm text-foreground data-[selected=true]:bg-hover sm:min-h-10 [&_svg]:size-4 [&_svg]:text-muted-foreground";
  const group = "px-2 pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] [&_[cmdk-group-heading]]:text-muted-foreground";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-[var(--overlay)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-1.5rem)] max-w-[620px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
                initial={{ opacity: 0, scale: 0.97, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                <DialogPrimitive.Title className="sr-only">Palette de commandes</DialogPrimitive.Title>
                <Command label="Palette de commandes" loop shouldFilter>
                  <div className="flex items-center gap-3 border-b border-border px-4">
                    <Search className="size-4 shrink-0 text-muted-foreground" />
                    <Command.Input
                      value={query}
                      onValueChange={setQuery}
                      placeholder={searchTenants ? "Rechercher une page, une action, un restaurant…" : "Rechercher une page ou une action…"}
                      className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
                    />
                    <Kbd className="hidden sm:inline-flex">Échap</Kbd>
                  </div>
                  <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto py-1">
                    <Command.Empty className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {searching ? "Recherche…" : "Aucun résultat."}
                    </Command.Empty>

                    {tenants.length > 0 && (
                      <Command.Group heading="Restaurants" className={group}>
                        {tenants.map((t) => (
                          <Command.Item key={t.id} value={`restaurant ${t.name} ${t.slug}`} onSelect={() => run(() => onTenant?.(t))} className={item}>
                            <Store />
                            <span className="min-w-0 flex-1 truncate">{t.name} <span className="font-mono text-xs text-muted-foreground">{t.slug}</span></span>
                            <StatusBadge status={t.status} labels={TENANT_STATUS_LABEL} />
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    {actions.length > 0 && (
                      <Command.Group heading="Actions" className={group}>
                        {actions.map((a) => (
                          <Command.Item key={a.id} value={a.label} keywords={a.keywords} onSelect={() => run(a.run)} className={item}>
                            {a.icon}<span className="flex-1">{a.label}</span>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    )}

                    <Command.Group heading="Navigation" className={group}>
                      {navigation.map((n) => (
                        <Command.Item key={n.id} value={`aller ${n.label}`} keywords={n.keywords} onSelect={() => run(n.run)} className={item}>
                          {n.icon}<span className="flex-1">{n.label}</span>
                          {n.shortcut && <Kbd>{n.shortcut}</Kbd>}
                        </Command.Item>
                      ))}
                    </Command.Group>

                    <Command.Group heading="Préférences" className={group}>
                      <Command.Item value="thème clair" onSelect={() => run(() => setPreference("light"))} className={item}><Sun /> Thème clair</Command.Item>
                      <Command.Item value="thème sombre" onSelect={() => run(() => setPreference("dark"))} className={item}><Moon /> Thème sombre</Command.Item>
                      <Command.Item value="thème système" onSelect={() => run(() => setPreference("system"))} className={item}><Monitor /> Thème du système</Command.Item>
                      <Command.Item value="se déconnecter" onSelect={() => run(() => void session.logout())} className={item}><LogOut /> Se déconnecter</Command.Item>
                    </Command.Group>
                  </Command.List>
                  <div className="hidden items-center justify-end gap-4 border-t border-border bg-subtle px-4 py-2 text-xs text-muted-foreground sm:flex">
                    <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> naviguer</span>
                    <span className="flex items-center gap-1.5"><Kbd><CornerDownLeft className="size-3" /></Kbd> ouvrir</span>
                  </div>
                </Command>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/** Raccourci global ⌘K / Ctrl+K. */
export function useCommandShortcut(toggle: () => void) {
  React.useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [toggle]);
}

export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function useNavigateEntry() {
  const navigate = useNavigate();
  return React.useCallback((id: string, label: string, to: string, icon?: React.ReactNode, keywords?: string[]): CommandEntry => ({
    id, label, icon, keywords, run: () => navigate(to),
  }), [navigate]);
}
