import type { Metadata } from "next";
import Landing from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "AFYA MAZINGIRA, From environmental data to early action",
  description:
    "Hyperlocal environmental risk & early-action intelligence for JKUAT/Juja, Kenya. Live Conduit observations, Climate Reflex environmental states, +1/+3/+6/+9h forecasts with calibrated uncertainty, and deterministic Best-Time recommendations.",
};

export default function LandingPage() {
  return <Landing />;
}
