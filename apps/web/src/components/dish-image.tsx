import { UtensilsCrossed } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

/** Photo d'un plat, ou repère neutre (icône) quand il n'y en a pas / qu'elle ne charge pas. */
export function DishImage({ src, alt = "", className, iconClassName, loading = "lazy" }: {
  src?: string | null; alt?: string; className?: string; iconClassName?: string; loading?: "lazy" | "eager";
}) {
  const [broken, setBroken] = React.useState(false);
  React.useEffect(() => setBroken(false), [src]);
  if (src && !broken) {
    return <img src={src} alt={alt} loading={loading} decoding="async" onError={() => setBroken(true)} className={cn("bg-muted object-cover", className)} />;
  }
  return (
    <div aria-hidden className={cn("flex items-center justify-center bg-muted text-faint", className)}>
      <UtensilsCrossed className={cn("size-5", iconClassName)} />
    </div>
  );
}
