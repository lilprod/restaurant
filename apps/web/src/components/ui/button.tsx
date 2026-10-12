import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium",
    "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-foreground shadow-xs hover:brightness-110 dark:hover:brightness-115",
        secondary: "border border-border bg-background text-foreground shadow-xs hover:bg-hover hover:border-border-strong",
        ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
        danger: "bg-danger text-danger-foreground shadow-xs hover:brightness-110",
        "danger-ghost": "text-danger hover:bg-[var(--tone-red-bg)]",
        link: "h-auto px-0 text-brand-ink underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-9 px-3 text-[13px] sm:h-8",
        md: "h-11 px-4 sm:h-9",
        lg: "h-12 px-5 text-[15px] sm:h-11",
        icon: "size-11 sm:size-9",
        "icon-sm": "size-9 sm:size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? children : (
          <>
            {loading && <Spinner className="size-4" />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
