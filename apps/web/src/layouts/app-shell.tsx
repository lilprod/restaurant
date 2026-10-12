import { ChevronsUpDown, LogOut, Menu, Search, UserRound } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import * as React from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { BrandMark } from "@/components/brand-mark";
import { CommandPalette, isMac, useCommandShortcut, type CommandEntry, type TenantSearchResult } from "@/components/command-palette";
import { ThemeSwitcher, ThemeToggleButton } from "@/components/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { Sheet } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { useSession } from "@/providers/session";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
  keywords?: string[];
  /** Titre de groupe dans la barre latérale (affiché quand il change d'un lien au suivant). */
  section?: string;
}

interface AppShellProps {
  nav: NavItem[];
  spaceLabel: string;
  roleLabel: string;
  accountPath: string;
  actions?: CommandEntry[];
  searchTenants?: (q: string) => Promise<TenantSearchResult[]>;
  onTenant?: (t: TenantSearchResult) => void;
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Coquille de l'application : barre latérale fixe (≥ md), tiroir sur mobile, palette ⌘K,
 * menu utilisateur (compte, thème, déconnexion) et transition d'entrée de chaque page.
 */
export function AppShell({ nav, spaceLabel, roleLabel, accountPath, actions, searchTenants, onTenant, banner, children }: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [drawer, setDrawer] = React.useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const togglePalette = React.useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandShortcut(togglePalette);

  React.useEffect(() => { setDrawer(false); }, [location.pathname]);

  const navEntries: CommandEntry[] = React.useMemo(() => [
    ...nav.map((n) => ({ id: n.to, label: n.label, icon: n.icon, keywords: n.keywords, run: () => navigate(n.to) })),
    { id: "account", label: "Mon compte", icon: <UserRound />, keywords: ["profil", "mot de passe", "2fa", "sessions"], run: () => navigate(accountPath) },
  ], [nav, navigate, accountPath]);

  const sidebar = (
    <SidebarContent
      nav={nav}
      spaceLabel={spaceLabel}
      roleLabel={roleLabel}
      accountPath={accountPath}
      onSearch={() => { setDrawer(false); setPaletteOpen(true); }}
    />
  );

  return (
    <div className="min-h-dvh bg-background">
      <a href="#contenu" className="sr-only z-[60] rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Aller au contenu
      </a>

      {/* Barre latérale (bureau) */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[248px] border-r border-border bg-subtle md:flex md:flex-col">{sidebar}</aside>

      {/* Barre du haut (mobile) */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border bg-background/80 px-2 backdrop-blur-md md:hidden">
        <button type="button" aria-label="Ouvrir le menu" onClick={() => setDrawer(true)} className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-hover">
          <Menu className="size-5" />
        </button>
        <BrandMark showName size={24} className="flex-1" />
        <button type="button" aria-label="Rechercher" onClick={() => setPaletteOpen(true)} className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-hover">
          <Search className="size-[18px]" />
        </button>
        <ThemeToggleButton />
      </header>
      <Sheet open={drawer} onOpenChange={setDrawer} title="Menu de navigation"><LayoutGroup id="drawer">{sidebar}</LayoutGroup></Sheet>

      <div className="md:pl-[248px] print:pl-0">
        {banner}
        <main id="contenu" className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 md:pt-10 lg:px-10">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        navigation={navEntries}
        actions={actions}
        searchTenants={searchTenants}
        onTenant={onTenant}
      />
    </div>
  );
}

function SidebarContent({ nav, spaceLabel, roleLabel, accountPath, onSearch }: {
  nav: NavItem[]; spaceLabel: string; roleLabel: string; accountPath: string; onSearch: () => void;
}) {
  const session = useSession();
  const user = session.user;
  const navigate = useNavigate();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-1 px-4 pb-3 pt-5">
        <BrandMark showName size={28} />
        <span className="pl-[38px] text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{spaceLabel}</span>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onSearch}
          className="flex h-11 w-full items-center gap-2 rounded-md border border-border bg-background px-3 text-left text-sm text-muted-foreground shadow-xs transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
        >
          <Search className="size-4" />
          <span className="flex-1">Rechercher…</span>
          <span className="hidden items-center gap-0.5 sm:flex"><Kbd>{isMac() ? "⌘" : "Ctrl"}</Kbd><Kbd>K</Kbd></span>
        </button>
      </div>

      <nav aria-label="Navigation principale" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-0.5">
          {nav.map((n, i) => (
            <li key={n.to}>
              {n.section && n.section !== nav[i - 1]?.section && (
                <span className={cn("block px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint", i > 0 ? "pt-4" : "pt-1")}>{n.section}</span>
              )}
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) => cn(
                  "group relative flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9",
                  isActive ? "text-brand-ink" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-md bg-brand-tint"
                        transition={{ type: "spring", stiffness: 550, damping: 42 }}
                      />
                    )}
                    {isActive && <motion.span layoutId="nav-bar" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />}
                    <span className={cn("relative flex [&_svg]:size-4", isActive && "text-brand-ink")}>{n.icon}</span>
                    <span className="relative">{n.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar src={user?.avatarUrl} firstName={user?.firstName} lastName={user?.lastName} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{user?.firstName} {user?.lastName}</span>
                <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
              </span>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[224px]">
            <DropdownMenuLabel>
              <span className="block truncate text-foreground">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate(accountPath)}><UserRound /> Mon compte</DropdownMenuItem>
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm">
              <span>Thème</span>
              <ThemeSwitcher />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void session.logout()}><LogOut /> Se déconnecter</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
