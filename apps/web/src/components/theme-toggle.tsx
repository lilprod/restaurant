import { Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useTheme, type ThemePreference } from "@/providers/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Système", Icon: Monitor },
  { value: "light", label: "Clair", Icon: Sun },
  { value: "dark", label: "Sombre", Icon: Moon },
];

/** Sélecteur de thème compact (trois icônes) façon pied de page Vercel. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Thème" className={cn("inline-flex items-center rounded-full border border-border p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={(e) => { e.preventDefault(); setPreference(value); }}
            className={cn("relative flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-7", active && "text-foreground")}
          >
            {active && <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-full bg-muted ring-1 ring-border" transition={{ type: "spring", stiffness: 600, damping: 40 }} />}
            <Icon className="relative size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

/** Bouton icône clair ↔ sombre (barre du haut). */
export function ThemeToggleButton({ className }: { className?: string }) {
  const { resolved, setPreference } = useTheme();
  const dark = resolved === "dark";
  return (
    <button
      type="button"
      onClick={() => setPreference(dark ? "light" : "dark")}
      aria-label={dark ? "Passer en mode clair" : "Passer en mode sombre"}
      className={cn("relative flex size-11 items-center justify-center overflow-hidden rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-9", className)}
    >
      <motion.span key={dark ? "moon" : "sun"} initial={{ y: 12, opacity: 0, rotate: -30 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ duration: 0.2 }}>
        {dark ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </motion.span>
    </button>
  );
}
