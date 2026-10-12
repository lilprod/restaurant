import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/cn";
import { Label } from "./label";

interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
  /** Contenu à droite du libellé (lien « mot de passe oublié », compteur…). */
  aside?: React.ReactNode;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}

/** Champ de formulaire : libellé, contrôle, aide et erreur animée, reliés par aria-describedby. */
export function Field({ label, hint, error, required, className, aside, children }: FieldProps) {
  const autoId = React.useId();
  const id = children.props.id ?? autoId;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {(label || aside) && (
        <div className="flex items-center justify-between gap-2">
          {label && (
            <Label htmlFor={id}>
              {label}
              {required && <span className="ml-0.5 text-muted-foreground" aria-hidden>*</span>}
            </Label>
          )}
          {aside}
        </div>
      )}
      {React.cloneElement(children, { id, "aria-invalid": !!error || undefined, "aria-describedby": describedBy })}
      {hint && !error && <p id={`${id}-hint`} className="text-[12.5px] leading-snug text-muted-foreground">{hint}</p>}
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            id={`${id}-error`}
            role="alert"
            initial={{ opacity: 0, y: -4, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -4, height: 0 }}
            transition={{ duration: 0.16 }}
            className="text-[12.5px] leading-snug text-danger"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
