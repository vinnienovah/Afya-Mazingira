"use client";

import { useEffect } from "react";

// Registers the AFYA MAZINGIRA service worker for PWA installability
// and offline last-known-situation support.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Register after load to avoid competing with critical resources
    const register = () => {
      // Non-fatal: the app still works, but offline support and push do not,
      // and a silent failure leaves no way to tell that is why.
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err: unknown) => {
        console.warn("[afya] service worker registration failed, offline support and push are off:", err);
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
