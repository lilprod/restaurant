import * as React from "react";
import { useSearchParams } from "react-router-dom";

/** Paramètre d'URL lu/écrit comme un état (filtres partageables, « retour » qui fonctionne). */
export function useUrlParam(key: string, fallback = ""): [string, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = React.useCallback((v: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === null || v === "" || v === fallback) next.delete(key); else next.set(key, v);
      if (key !== "page") next.delete("page");
      return next;
    }, { replace: true });
  }, [key, fallback, setParams]);
  return [value, set];
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
