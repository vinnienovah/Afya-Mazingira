"use client";

import { useLanguage } from "@/lib/contexts/language";
import type { CurrentObservation } from "@/lib/afya/types";
import { fmtAgo } from "@/lib/afya/format";
import { Thermometer, Droplets, Wind, Sun, Gauge, Eye, Activity, CloudRain, Radio } from "lucide-react";

interface MeasureItem {
  icon: React.ReactNode;
  label_en: string;
  label_sw: string;
  value: string;
  accent: string;
}

export default function MeasurementStrip({
  obs,
  freshnessMinutes,
}: {
  obs: CurrentObservation;
  freshnessMinutes?: number;
}) {
  const { lang } = useLanguage();

  const items: MeasureItem[] = [
    {
      icon: <Thermometer className="w-4 h-4" />,
      label_en: "Temperature", label_sw: "Joto",
      value: `${obs.temperature_c.toFixed(1)}°C`,
      accent: "#E27832",
    },
    {
      icon: <Droplets className="w-4 h-4" />,
      label_en: "Humidity", label_sw: "Unyevu",
      value: `${obs.humidity_pct.toFixed(0)}%`,
      accent: "#3786B5",
    },
    {
      icon: <Wind className="w-4 h-4" />,
      label_en: "Wind", label_sw: "Upepo",
      value: `${obs.wind_speed_ms.toFixed(1)} m/s`,
      accent: "#6B8F71",
    },
    {
      icon: <Sun className="w-4 h-4" />,
      label_en: "IR Radiation", label_sw: "Mionzi",
      value: obs.infrared_signal > 0 ? `${Math.round(obs.infrared_signal)}` : "-",
      accent: "#F2B705",
    },
    {
      icon: <Gauge className="w-4 h-4" />,
      label_en: "Pressure", label_sw: "Shinikizo",
      value: `${obs.pressure_hpa.toFixed(1)} hPa`,
      accent: "#68756f",
    },
    {
      icon: <Activity className="w-4 h-4" />,
      label_en: "Wet Bulb", label_sw: "Bulbu Iliyonyevunyevu",
      value: `${obs.wet_bulb_c.toFixed(1)}°C`,
      accent: "#247B78",
    },
    {
      icon: <Eye className="w-4 h-4" />,
      label_en: "WBGT-like", label_sw: "WBGT",
      value: `${obs.wbgt_c.toFixed(1)}°C`,
      accent: "#103D2C",
    },
    {
      icon: <CloudRain className="w-4 h-4" />,
      label_en: "Rain (this reading)", label_sw: "Mvua (kipimo hiki)",
      value: obs.rain_observed ? (lang === "sw" ? "Inaonekana" : "Observed") : (lang === "sw" ? "Hakuna" : "None"),
      accent: "#3786B5",
    },
  ];

  return (
    <div>
      {/* Single source note replaces a per-card "MEASURED · Conduit" tag */}
      <div className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold text-afya-muted">
        <Radio className="w-3.5 h-3.5 text-afya-green" strokeWidth={2} aria-hidden="true" />
        {lang === "sw"
          ? "Vipimo vyote vimepimwa moja kwa moja na kituo cha Conduit JKUAT"
          : "All readings measured directly by the JKUAT Conduit ground station"}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-xl border border-afya-border bg-white p-3.5 flex flex-col gap-2"
          >
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${item.accent}15`, color: item.accent }}
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <div>
              <div className="text-lg font-bold text-afya-charcoal leading-none">{item.value}</div>
              <div className="text-[11px] text-afya-muted mt-1">{lang === "sw" ? item.label_sw : item.label_en}</div>
            </div>
          </div>
        ))}
      </div>

      {freshnessMinutes !== undefined && (
        <p className="mt-3 text-[11px] text-afya-muted/70 text-right">
          {lang === "sw" ? `Imesasishwa ${fmtAgo(freshnessMinutes, "sw")}` : `Updated ${fmtAgo(freshnessMinutes, "en")}`}
        </p>
      )}
    </div>
  );
}
