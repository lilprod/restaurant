import * as React from "react";
import { cn } from "@/lib/cn";

export const inputClass = cn(
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-[15px] text-foreground shadow-xs sm:h-9 sm:text-sm",
  "placeholder:text-faint transition-[border-color,box-shadow] duration-150",
  "hover:border-border-strong focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
  "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20",
  "file:border-0 file:bg-transparent file:text-sm file:font-medium",
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Élément affiché à gauche (icône, préfixe). */
  leading?: React.ReactNode;
  /** Élément affiché à droite (suffixe, bouton). */
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, leading, trailing, ...props }, ref) => {
  if (!leading && !trailing) return <input ref={ref} className={cn(inputClass, className)} {...props} />;
  return (
    <div className="relative flex w-full items-center">
      {leading && <span className="pointer-events-none absolute left-3 flex items-center text-muted-foreground [&_svg]:size-4">{leading}</span>}
      <input ref={ref} className={cn(inputClass, leading && "pl-9", trailing && "pr-11", className)} {...props} />
      {trailing && <span className="absolute right-1.5 flex items-center text-muted-foreground">{trailing}</span>}
    </div>
  );
});
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(inputClass, "h-auto min-h-[88px] py-2 leading-relaxed", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative w-full">
      <select ref={ref} className={cn(inputClass, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <svg aria-hidden viewBox="0 0 16 16" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground">
        <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  ),
);
NativeSelect.displayName = "NativeSelect";
