import * as React from "react";
import { cn } from "@/lib/cn";
import { useBranding } from "@/providers/branding";
import { useTheme } from "@/providers/theme";

/** Logo de la marque courante (variante sombre en mode sombre), ou monogramme aux couleurs de la marque. */
export function BrandMark({ className, size = 28, showName = false, nameClassName }: { className?: string; size?: number; showName?: boolean; nameClassName?: string }) {
  const { branding } = useBranding();
  const { resolved } = useTheme();
  const [broken, setBroken] = React.useState(false);
  const url = resolved === "dark" ? branding?.logoDarkUrl ?? branding?.logoUrl : branding?.logoUrl;
  React.useEffect(() => setBroken(false), [url]);
  const name = branding?.displayName ?? "";
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {url && !broken ? (
        <img src={url} alt={name} onError={() => setBroken(true)} style={{ height: size, maxWidth: size * 4 }} className="shrink-0 object-contain" />
      ) : (
        <span
          aria-hidden={showName}
          className="flex shrink-0 items-center justify-center rounded-md bg-brand font-brand font-semibold text-brand-foreground shadow-xs"
          style={{ width: size, height: size, fontSize: size * 0.46 }}
        >
          {(name.trim()[0] ?? "R").toUpperCase()}
        </span>
      )}
      {/* Un logo est en général un logotype : on n'y ajoute pas le nom (sinon « Chez Kofi Chez Kofi »). */}
      {showName && !(url && !broken) && <span className={cn("truncate font-brand text-[15px] font-semibold tracking-tight", nameClassName)}>{name}</span>}
    </span>
  );
}
