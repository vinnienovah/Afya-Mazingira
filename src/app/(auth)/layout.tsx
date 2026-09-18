import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: "linear-gradient(135deg, #103D2C 0%, #0a2a1e 100%)" }}
    >
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
