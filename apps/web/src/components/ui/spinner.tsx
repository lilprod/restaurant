import { cn } from "@/lib/cn";

/** Indicateur de chargement façon Geist (12 segments). */
export function Spinner({ className }: { className?: string }) {
  return (
    <span role="status" aria-label="Chargement" className={cn("relative inline-block size-4", className)}>
      {Array.from({ length: 12 }, (_, i) => (
        <span
          key={i}
          className="absolute left-[46%] top-[4%] h-[26%] w-[8%] rounded-full bg-current"
          style={{
            transform: `rotate(${i * 30}deg)`,
            transformOrigin: "50% 175%",
            opacity: 0.15,
            animation: "spinner-fade 1s linear infinite",
            animationDelay: `${-1 + i / 12}s`,
          }}
        />
      ))}
      <style>{"@keyframes spinner-fade{0%{opacity:1}100%{opacity:.15}}"}</style>
    </span>
  );
}
