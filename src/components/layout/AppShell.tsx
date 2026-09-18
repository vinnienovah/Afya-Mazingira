"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import MobileNav from "./MobileNav";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";
import CommandPalette from "@/components/command/CommandPalette";

const AUTH_PATHS = ["/sign-in", "/sign-up"];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = AUTH_PATHS.some((p) => pathname.startsWith(p));

  if (isAuthPage) {
    return (
      <>
        <ServiceWorkerRegister />
        {children}
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-afya-canvas">
      <ServiceWorkerRegister />
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:shrink-0">
        <Sidebar />
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto overflow-x-hidden" id="main-content">
          <div className="min-h-full px-4 py-5 sm:px-6 lg:px-8 pb-24 lg:pb-8">
            {children}
          </div>
        </main>

        {/* Mobile bottom nav */}
        <div className="lg:hidden">
          <MobileNav />
        </div>
      </div>

      {/* Global command palette (⌘K) */}
      <CommandPalette />
    </div>
  );
}
