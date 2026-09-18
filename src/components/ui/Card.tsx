"use client";

import type { ReactNode, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export function Card({ children, className, padding = true, ...props }: CardProps) {
  return (
    <div
      className={cn("card-afya", padding && "p-5", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-sm font-semibold text-afya-charcoal mb-3", className)}>
      {children}
    </h3>
  );
}

export function CardMeta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-xs text-afya-muted", className)}>
      {children}
    </p>
  );
}
