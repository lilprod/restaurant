import { validatePassword, type PasswordPolicy } from "@restaurant/utils";
import { Check, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

/**
 * Liste des règles de mot de passe, évaluée en direct avec `validatePassword` (@restaurant/utils),
 * la même fonction que l'API. Les règles « contextuelles » (mot courant, email, nom) n'apparaissent qu'en cas d'échec.
 */
export function PasswordChecklist({ password, policy, email, names, className }: {
  password: string; policy: PasswordPolicy; email?: string; names?: string[]; className?: string;
}) {
  const failures = new Set(validatePassword(password, policy, { email, names }));
  const rules = [
    `Au moins ${policy.minLength} caractères`,
    policy.requireUpper && "Au moins une majuscule",
    policy.requireLower && "Au moins une minuscule",
    policy.requireDigit && "Au moins un chiffre",
    policy.requireSymbol && "Au moins un symbole",
  ].filter((r): r is string => !!r);
  const extra = [...failures].filter((f) => !rules.includes(f) && password.length > 0);
  const passed = rules.filter((r) => !failures.has(r)).length;
  const strength = password ? (passed + (extra.length ? 0 : 1)) / (rules.length + 1) : 0;

  return (
    <div className={cn("@container flex flex-col gap-2.5", className)} aria-live="polite">
      <div className="flex h-1 gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-full flex-1 overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn("h-full rounded-full", strength >= 1 ? "bg-success" : strength > 0.6 ? "bg-[var(--tone-amber-dot)]" : "bg-[var(--tone-red-dot)]")}
              initial={false}
              animate={{ width: strength * 4 > i ? "100%" : "0%" }}
              transition={{ duration: 0.2 }}
            />
          </div>
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 @md:grid-cols-2">
        {rules.map((r) => {
          const ok = password.length > 0 && !failures.has(r);
          return (
            <li key={r} className={cn("flex items-center gap-2 text-[13px] transition-colors", ok ? "text-foreground" : "text-muted-foreground")}>
              <span className={cn("flex size-4 items-center justify-center rounded-full transition-colors", ok ? "bg-success text-white" : "border border-border-strong")}>
                <AnimatePresence>{ok && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}><Check className="size-3" strokeWidth={3} /></motion.span>}</AnimatePresence>
              </span>
              {r}
            </li>
          );
        })}
        {extra.map((r) => (
          <li key={r} className="flex items-center gap-2 text-[13px] text-danger">
            <span className="flex size-4 items-center justify-center rounded-full bg-danger text-white"><X className="size-3" strokeWidth={3} /></span>
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function isPasswordValid(password: string, policy: PasswordPolicy, ctx: { email?: string; names?: string[] } = {}) {
  return validatePassword(password, policy, ctx).length === 0;
}
