import * as React from "react";

export type ThemePreference = "light" | "dark" | "system";
const KEY = "restaurant.theme";

interface ThemeCtx {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (p: ThemePreference) => void;
  /** Mode par défaut choisi par la marque (utilisé tant que l'utilisateur n'a rien choisi). */
  setBrandDefault: (m: ThemePreference | undefined) => void;
}

const Ctx = React.createContext<ThemeCtx | null>(null);

function readStored(): ThemePreference | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" || v === "system" ? v : null;
  } catch { return null; }
}

const media = () => (typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = React.useState<ThemePreference | null>(readStored);
  const [brandDefault, setBrandDefault] = React.useState<ThemePreference | undefined>(undefined);
  const [systemDark, setSystemDark] = React.useState(() => media()?.matches ?? false);

  React.useEffect(() => {
    const m = media();
    if (!m) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);

  const preference: ThemePreference = stored ?? brandDefault ?? "system";
  const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = React.useCallback((p: ThemePreference) => {
    setStored(p);
    try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  }, []);

  const value = React.useMemo(() => ({ preference, resolved, setPreference, setBrandDefault }), [preference, resolved, setPreference]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useTheme hors ThemeProvider");
  return v;
}
