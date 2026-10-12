import * as React from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

/** Avatar : image si disponible, sinon initiales sur un dégradé déterministe. */
export function Avatar({ src, firstName, lastName, className, size = 32 }: {
  src?: string | null; firstName?: string | null; lastName?: string | null; className?: string; size?: number;
}) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [src]);
  const seed = `${firstName ?? ""}${lastName ?? ""}`.split("").reduce((n, c) => n + c.charCodeAt(0), 0);
  const hue = seed % 360;
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border text-[11px] font-semibold text-white", className)}
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 70% 45%))`, fontSize: Math.max(10, size * 0.36) }}
    >
      {src && !broken ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden>{initials(firstName, lastName)}</span>
      )}
    </span>
  );
}
