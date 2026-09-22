"use client";

import { useLanguage } from "@/lib/contexts/language";
import type { CurrentObservation, SituationResult } from "@/lib/afya/types";
import { fmtAgo } from "@/lib/afya/format";
import { filledReadings } from "@/lib/afya/display";
import { cn } from "@/lib/utils";
import { Thermometer, Droplets, Wind, Sun, Gauge, Eye, Activity, CloudRain, Radio, FlaskConical } from "lucide-react";

interface MeasureItem {
  key: string;
  icon: React.ReactNode;
  label_en: string;
  label_sw: string;
  value: string;
  accent: string;
}

export default function MeasurementStrip({
  obs,
  freshnessMinutes,
  dataSource,
  feed,
}: {
  obs: CurrentObservation;
  freshnessMinutes?: number;
  dataSource?: SituationResult["data_source"];
  feed?: SituationResult["data_feed"];
}) {
  const { t, lang } = useLanguage();
  const filled = filledReadings(obs.imputed, feed);
  const demo = dataSource === "DEMO";

  const items: MeasureItem[] = [
    {
      key: "temperature",
      icon: <Thermometer className="w-4 h-4" />,
      label_en: "Temperature", label_sw: "Joto",
      value: `${obs.temperature_c.toFixed(1)}°C`,
      accent: "#E27832",
    },
    {
      key: "humidity",
      icon: <Droplets className="w-4 h-4" />,
      label_en: "Humidity", label_sw: "Unyevu",
      value: `${obs.humidity_pct.toFixed(0)}%`,
      accent: "#3786B5",
    },
    {
      key: "wind",
      icon: <Wind className="w-4 h-4" />,
      label_en: "Wind", label_sw: "Upepo",
      value: `${obs.wind_speed_ms.toFixed(1)} m/s`,
      accent: "#6B8F71",
    },
    {
      key: "infrared",
      icon: <Sun className="w-4 h-4" />,
      label_en: "Infrared light (sensor counts)", label_sw: "Mwanga wa infraredi (hesabu za kihisi)",
      value: `${Math.round(obs.infrared_signal)}`,
      accent: "#F2B705",
    },
    {
      key: "pressure",
      icon: <Gauge className="w-4 h-4" />,
      label_en: "Pressure", label_sw: "Shinikizo",
      value: `${obs.pressure_hpa.toFixed(1)} hPa`,
      accent: "#68756f",
    },
    {
      key: "wet_bulb",
      icon: <Activity className="w-4 h-4" />,
      label_en: "Wet Bulb", label_sw: "Balbu Nyevu",
      value: `${obs.wet_bulb_c.toFixed(1)}°C`,
      accent: "#247B78",
    },
    {
      key: "wbgt",
      icon: <Eye className="w-4 h-4" />,
      label_en: "WBGT (shade, computed)", label_sw: "WBGT (kivuli, imekokotolewa)",
      value: `${obs.wbgt_c.toFixed(1)}°C`,
      accent: "#103D2C",
    },
    {
      key: "rain",
      icon: <CloudRain className="w-4 h-4" />,
      label_en: "Rain (this reading)", label_sw: "Mvua (kipimo hiki)",
      value: filled.has("rain")
        ? t("not_available")
        : obs.rain_observed ? (lang === "sw" ? "Inaonekana" : "Observed") : (lang === "sw" ? "Hakuna" : "None"),
      accent: "#3786B5",
    },
  ];

  return (
    <div>
      <div className="flex items-start gap-1.5 mb-3 text-[11px] font-semibold text-afya-muted">
        {demo
          ? <FlaskConical className="w-3.5 h-3.5 mt-px shrink-0 text-afya-gold" strokeWidth={2} aria-hidden="true" />
          : <Radio className="w-3.5 h-3.5 mt-px shrink-0 text-afya-green" strokeWidth={2} aria-hidden="true" />}
        <span>
          {demo ? t("readings_demo") : dataSource === "CONDUIT_ARCHIVE" ? t("readings_archive") : t("readings_station")}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {items.map((item) => {
          const isFilled = filled.has(item.key);
          return (
            <div
              key={item.key}
              className={cn(
                "rounded-xl border bg-white p-3.5 flex flex-col gap-2",
                isFilled ? "border-dashed border-afya-muted/40" : "border-afya-border",
              )}
            >
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${item.accent}15`, color: item.accent }}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <div>
                <div className={cn("text-lg font-bold leading-none", isFilled ? "text-afya-muted" : "text-afya-charcoal")}>
                  {item.value}
                </div>
                <div className="text-[11px] text-afya-muted mt-1">{lang === "sw" ? item.label_sw : item.label_en}</div>
                {isFilled && (
                  <div className="mt-1 inline-block rounded bg-afya-canvas px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-afya-muted">
                    {t("reading_filled")}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filled.size > 0 && (
        <p className="mt-3 text-[11px] text-afya-muted">{t("readings_filled_note")}</p>
      )}

      {freshnessMinutes !== undefined && (
        <p className="mt-3 text-[11px] text-afya-muted/70 text-right">
          {lang === "sw" ? `Imesasishwa ${fmtAgo(freshnessMinutes, "sw")}` : `Updated ${fmtAgo(freshnessMinutes, "en")}`}
        </p>
      )}
    </div>
  );
}
