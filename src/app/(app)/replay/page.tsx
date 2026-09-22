"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Historical Replay now lives as a tab on the consolidated Dashboard
// (/climate) rather than its own page, this redirects any existing link
// or bookmark straight there instead of leaving a dangling duplicate page.
export default function ReplayPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/climate?tab=replay");
  }, [router]);
  return null;
}
