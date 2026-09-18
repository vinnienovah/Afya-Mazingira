"use client";

import { useLanguage } from "@/lib/contexts/language";
import type { CurrentObservation, Provenance } from "@/lib/afya/types";
import { fmtAgo } from "@/lib/afya/format";
import { Thermometer, Droplets, Wind, Sun, Gauge, Eye, Activity } from "lucide-react";

interface MeasureItem {
  icon: React.ReactNode;
  label_en: string;
  label_sw: string;
  value: string;
  provenance: Provenance;
  note?: string;
}

const PROVENANCE_LABELS: Record<Provenance, { en: string; sw: string }> = {
  MEASURED: { en: "MEASURED", sw: "ILIPIMEWA" },
  PREDICTED: { en: "PREDICTED", sw: "ILITABIRIWA" },
  SATELLITE_DERIVED: { en: "SATELLITE-DERIVED", sw: "KUTOKA SAYETI" },
  REGIONAL_MODEL: { en: "REGIONAL MODEL", sw: "MFUMO WA KIKANDA" },
  HISTORICAL: { en: "HISTORICAL", sw: "KIHISTORIA" },
  DERIVED: { en: "AFYA MAZINGIRA DERIVED", sw: "IMECHAKATWA" },
};

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
      provenance: "MEASURED",
    },
    {
      icon: <Droplets className="w-4 h-4" />,
      label_en: "Humidity", label_sw: "Unyevu",
      value: `${obs.humidity_pct.toFixed(0)}%`,
      provenance: "MEASURED",
    },
    {
      icon: <Wind className="w-4 h-4" />,
      label_en: "Wind", label_sw: "Upepo",
      value: `${obs.wind_speed_ms.toFixed(1)} m/s`,
      provenance: "MEASURED",
    },
    {
      icon: <Sun className="w-4 h-4" />,
      label_en: "IR Radiation", label_sw: "Mionzi",
      value: obs.infrared_signal > 0 ? `${Math.round(obs.infrared_signal)}` : "—",
      provenance: "MEASURED",
    },
    {
      icon: <Gauge className="w-4 h-4" />,
      label_en: "Pressure", label_sw: "Shinikizo",
      value: `${obs.pressure_hpa.toFixed(1)} hPa`,
      provenance: "MEASURED",
    },
    {
      icon: <Activity className="w-4 h-4" />,
      label_en: "Wet Bulb", label_sw: "Bulbu Iliyonyevunyevu",
      value: `${obs.wet_bulb_c.toFixed(1)}°C`,
      provenance: "MEASURED",
    },
    {
      icon: <Eye className="w-4 h-4" />,
      label_en: "WBGT-like", label_sw: "WBGT",
      value: `${obs.wbgt_c.toFixed(1)}°C`,
      provenance: "MEASURED",
    },
    {
      icon: <Droplets className="w-4 h-4" />,
      label_en: "Rain", label_sw: "Mvua",
      value: obs.rain_observed ? (lang === "sw" ? "Inaonekana" : "Observed") : (lang === "sw" ? "Hakuna" : "None"),
      provenance: "MEASURED",
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-xl border border-afya-border bg-white p-3 flex flex-col gap-1.5"
          >
            <span className="text-afya-muted" aria-hidden="true">{item.icon}</span>
            <span className="text-base font-bold text-afya-charcoal leading-none">{item.value}</span>
            <span className="text-[11px] text-afya-muted">{lang === "sw" ? item.label_sw : item.label_en}</span>
            <span className="text-[9px] font-semibold text-afya-muted/60 tracking-wide uppercase">
              {PROVENANCE_LABELS[item.provenance][lang]} · Conduit
            </span>
          </div>
        ))}
      </div>
      {freshnessMinutes !== undefined && (
        <p className="mt-2 text-[11px] text-afya-muted/70 text-right">
          {lang === "sw" ? `Imesasishwa ${fmtAgo(freshnessMinutes, "sw")}` : `Updated ${fmtAgo(freshnessMinutes, "en")}`}
        </p>
      )}
    </div>
  );
}
