import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-white",
        outline: "text-foreground",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        danger: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
        info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
        neutral: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
        accent: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const STATUS_VARIANTS = Object.freeze({
  active: "success",
  approved: "success",
  consumed: "success",
  delivered: "success",
  sent: "success",
  needs_information: "warning",
  pending: "warning",
  queued: "warning",
  dead_lettered: "danger",
  failed: "danger",
  rejected: "danger",
  confirmed: "info",
  processing: "info",
  received: "info",
  canceled: "neutral",
  disabled: "neutral",
  inactive: "neutral",
  revoked: "neutral",
  escalated: "accent",
  expired: "accent",
});

const statusBadgeVariant = (status) => STATUS_VARIANTS[status] || "neutral";

function Badge({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? Slot : "span";

  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, statusBadgeVariant };
