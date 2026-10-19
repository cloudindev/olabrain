import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-panel)] border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
      <h2 className="font-display text-sm font-semibold tracking-tight text-ink">{title}</h2>
      {aside}
    </div>
  );
}
