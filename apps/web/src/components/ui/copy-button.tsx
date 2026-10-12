import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli (contexte non sécurisé)
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({ value, label = "Copier", className, toastMessage = "Copié dans le presse-papiers" }: {
  value: string; label?: string; className?: string; toastMessage?: string | null;
}) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(value)) { setDone(true); if (toastMessage) toast.success(toastMessage); }
      }}
      aria-label={done ? "Copié" : label}
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-8",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={done ? "ok" : "copy"}
          initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.14 }}
          className="flex"
        >
          {done ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/** Valeur monospace + bouton copier (numéros Flooz, secret 2FA, mot de passe temporaire…). */
export function CopyField({ value, className, mono = true }: { value: string; className?: string; mono?: boolean }) {
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-2 rounded-md border border-border bg-subtle pl-3 pr-1 sm:min-h-10", className)}>
      <span className={cn("min-w-0 break-all py-2 text-sm", mono && "font-mono tracking-tight")}>{value}</span>
      <CopyButton value={value} />
    </div>
  );
}
