"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

export default function BriefingActions({
  backLabel,
  printLabel,
}: {
  backLabel: string;
  printLabel: string;
}) {
  return (
    <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3">
      <Link
        href="/situation"
        className="inline-flex items-center gap-1.5 rounded-lg border border-afya-border bg-white px-3 py-2 text-xs font-semibold text-afya-charcoal hover:bg-afya-canvas"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        {backLabel}
      </Link>
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-lg bg-afya-green px-4 py-2 text-xs font-bold text-white hover:bg-afya-green/90"
      >
        <Printer className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        {printLabel}
      </button>
    </div>
  );
}
