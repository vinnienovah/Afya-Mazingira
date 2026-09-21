import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/lib/contexts/language";
import { AuthProvider } from "@/lib/contexts/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s | AFYA MAZINGIRA",
    default: "AFYA MAZINGIRA, Environmental Risk & Early Action Intelligence",
  },
  description:
    "AFYA MAZINGIRA transforms environmental observations into forecasts, risk assessments, and early-action recommendations for JKUAT/Juja, Kenya.",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "AFYA MAZINGIRA" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#103D2C",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="bg-afya-canvas text-afya-charcoal antialiased">
        <LanguageProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
