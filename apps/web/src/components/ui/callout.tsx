import { CircleAlert, Info, TriangleAlert, CircleCheck } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/cn";

const tones = {
  info: { cls: "border-[color-mix(in_oklab,var(--tone-blue-dot)_30%,var(--border))] bg-[var(--tone-blue-bg)] text-[var(--tone-blue-fg)]", Icon: Info },
  warning: { cls: "border-[color-mix(in_oklab,var(--tone-amber-dot)_35%,var(--border))] bg-[var(--tone-amber-bg)] text-[var(--tone-amber-fg)]", Icon: TriangleAlert },
  danger: { cls: "border-[color-mix(in_oklab,var(--tone-red-dot)_30%,var(--border))] bg-[var(--tone-red-bg)] text-[var(--tone-red-fg)]", Icon: CircleAlert },
  success: { cls: "border-[color-mix(in_oklab,var(--tone-green-dot)_30%,var(--border))] bg-[var(--tone-green-bg)] text-[var(--tone-green-fg)]", Icon: CircleCheck },
};

export function Callout({ tone = "info", title, children, className, action }: {
  tone?: keyof typeof tones; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode;
}) {
  const { cls, Icon } = tones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="opacity-90 [&_a]:underline">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
