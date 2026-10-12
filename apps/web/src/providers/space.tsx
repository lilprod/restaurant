import * as React from "react";

/** Préfixe des routes de l'espace courant (`/admin`, `/r/chez-kofi`, ou `""` en sous-domaine). */
const Ctx = React.createContext<{ base: string; kind: "platform" | "tenant" }>({ base: "", kind: "platform" });

export function SpaceRoutesProvider({ base, kind, children }: { base: string; kind: "platform" | "tenant"; children: React.ReactNode }) {
  const v = React.useMemo(() => ({ base, kind }), [base, kind]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

/** `to("/parametres")` → `/r/chez-kofi/parametres`. */
export function useSpacePath() {
  const { base } = React.useContext(Ctx);
  return React.useCallback((p = "") => {
    if (p === "" || p === "/") return base || "/";   // pas de « /admin/ » : NavLink `end` ne le reconnaîtrait pas
    return `${base}${p.startsWith("/") ? p : `/${p}`}`;
  }, [base]);
}

export const useSpaceKind = () => React.useContext(Ctx).kind;
