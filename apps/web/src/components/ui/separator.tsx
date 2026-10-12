import { cn } from "@/lib/cn";

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} className={cn(vertical ? "w-px self-stretch" : "h-px w-full", "bg-border", className)} />;
}
