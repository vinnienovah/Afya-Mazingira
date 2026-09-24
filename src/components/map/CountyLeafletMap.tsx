"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap } from "react-leaflet";
import type { Layer, PathOptions, LeafletKeyboardEvent } from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { JKUAT_COORDS, RISK_META } from "@/lib/afya/constants";
import type { CountyFeature } from "@/lib/afya/map-data";
import {
  HOUR_SOURCE_LABEL_KEY, NO_DATA_COLOUR, ndviColour, outlookColour, rainColour, thermalColour,
} from "@/lib/afya/map-scales";
import "leaflet/dist/leaflet.css";

const JKUAT: [number, number] = [JKUAT_COORDS.lat, JKUAT_COORDS.lng];

export type MapLayerKey = "outlook" | "thermal" | "rain" | "vegetation";

interface CountyProps {
  name: string;
  code?: number;
}

interface Props {
  /** Authoritative county boundaries (GeoJSON, EPSG:4326) */
  boundaries: FeatureCollection<Geometry, CountyProps> | null;
  /** Indicator data keyed by county name */
  indicators: Record<string, CountyFeature["properties"]>;
  layer: MapLayerKey;
  timeIdx: number;
  selectedCounty: string | null;
  onSelectCounty: (name: string | null) => void;
  onSelectStation: () => void;
  stationLabel: string;
  stationSubLabel: string;
  lang: string;
  t: (key: string) => string;
}

function colourFor(layer: MapLayerKey, p: CountyFeature["properties"] | undefined, timeIdx: number): string {
  if (!p) return NO_DATA_COLOUR;
  const hour = p.outlook_hours?.[timeIdx];
  if (layer === "outlook") return outlookColour(hour?.category);
  if (layer === "thermal") return thermalColour(hour?.temp_c);
  if (layer === "rain") return rainColour(p.rain_today_mm);
  return NO_DATA_COLOUR; // Local NDVI samples must not colour whole counties.
}

/** The tooltip line for the selected layer and hour. */
function tooltipDetail(
  layer: MapLayerKey,
  p: CountyFeature["properties"],
  timeIdx: number,
  lang: string,
  t: (key: string) => string,
): string {
  const hour = p.outlook_hours?.[timeIdx];
  const noData = t("no_data");
  if (layer === "thermal" || layer === "outlook") {
    if (!hour) return noData;
    const parts: string[] = [`${hour.hour} EAT`];
    if (layer === "outlook") {
      parts.push(hour.category ? (lang === "sw" ? RISK_META[hour.category].sw : RISK_META[hour.category].en) : noData);
    }
    parts.push(
      `${t("map_air_temp")} ${hour.temp_c != null ? `${hour.temp_c.toFixed(1)} °C` : noData}` +
        (hour.temp_source ? ` (${t(HOUR_SOURCE_LABEL_KEY[hour.temp_source])})` : ""),
    );
    parts.push(
      `${t("map_shade_wbgt")} ${hour.wbgt_c != null ? `${hour.wbgt_c.toFixed(1)} °C` : noData}` +
        (hour.wbgt_source ? ` (${t(HOUR_SOURCE_LABEL_KEY[hour.wbgt_source])})` : ""),
    );
    const stats = layer === "thermal" ? hour.spatial?.temperature : hour.spatial?.wbgt;
    if (stats) {
      parts.push(`${t("map_sample_mean")} · ${stats.valid_samples}/${stats.total_samples}`);
      parts.push(`${t("map_sample_coverage")}: ${stats.coverage_pct.toFixed(0)}%`);
      if (stats.min != null && stats.max != null) parts.push(`${t("map_sample_range")}: ${stats.min.toFixed(1)}–${stats.max.toFixed(1)} °C`);
    }
    return parts.join("<br/>");
  }
  if (layer === "rain") {
    return `${t("map_rain_today")}: ${p.rain_today_mm != null ? `${p.rain_today_mm.toFixed(1)} mm` : noData}`;
  }
  return `${t("map_local_ndvi")}: ${p.ndvi_mean != null ? p.ndvi_mean.toFixed(2) : noData}`;
}

/** Keeps Leaflet sized correctly inside responsive/flex layouts. */
function ResizeHandler() {
  const map = useMap();
  useEffect(() => {
    const fix = () => map.invalidateSize();
    const id = setTimeout(fix, 120);
    window.addEventListener("resize", fix);
    return () => {
      clearTimeout(id);
      window.removeEventListener("resize", fix);
    };
  }, [map]);
  return null;
}

export default function CountyLeafletMap({
  boundaries, indicators, layer, timeIdx,
  selectedCounty, onSelectCounty, onSelectStation,
  stationLabel, stationSubLabel, lang, t,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  // Built from the current controls: the GeoJSON below is remounted whenever
  // they change and styles its counties once, as it mounts.
  const styleFor = useMemo(
    () => (feature?: Feature<Geometry, CountyProps>): PathOptions => {
      const name = feature?.properties?.name ?? "";
      const p = indicators[name];
      const isSelected = selectedCounty === name;
      const isHovered = hovered === name;
      const fillColor = colourFor(layer, p, timeIdx);
      // A dashed outline marks no data as well as the grey, for readers who cannot tell the fills apart.
      const noData = fillColor === NO_DATA_COLOUR;
      return {
        fillColor,
        fillOpacity: noData ? 0.45 : isSelected ? 0.85 : isHovered ? 0.78 : 0.68,
        color: isSelected ? "#17211C" : noData ? "#68756F" : "#ffffff",
        weight: isSelected ? 2.5 : isHovered ? 2 : 1,
        dashArray: noData && !isSelected ? "4 3" : undefined,
        opacity: 1,
      };
    },
    [indicators, layer, timeIdx, selectedCounty, hovered],
  );

  // Re-render styles when controls change
  const geoKey = `${layer}-${timeIdx}-${selectedCounty ?? "none"}-${hovered ?? "none"}`;

  const onEachFeature = useMemo(
    () => (feature: Feature<Geometry, CountyProps>, lyr: Layer) => {
      const name = feature.properties?.name ?? "";
      const p = indicators[name];
      lyr.on({
        mouseover: () => setHovered(name),
        mouseout: () => setHovered(null),
        click: () => onSelectCounty(selectedCounty === name ? null : name),
        keydown: (e: LeafletKeyboardEvent) => {
          if (e.originalEvent?.key === "Enter") onSelectCounty(name);
        },
      });
      const detail = p ? tooltipDetail(layer, p, timeIdx, lang, t) : t("no_data");
      lyr.bindTooltip(
        `<strong>${name}</strong><br/><span style="font-size:11px">${detail}</span>`,
        { sticky: true, direction: "top", className: "afya-tooltip" },
      );
    },
    [indicators, onSelectCounty, selectedCounty, timeIdx, lang, layer, t],
  );

  return (
    <div className="relative w-full" style={{ height: 460 }}>
      <MapContainer
        center={[-1.35, 37.1]}
        zoom={8}
        minZoom={6}
        maxZoom={12}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%", background: "#e8f0ea" }}
        attributionControl
      >
        <ResizeHandler />

        {/* OpenStreetMap tiles, greyed in CSS so the risk colours carry the meaning.
            CARTO's light tiles now need an API key and render a watermark without one. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          className="afya-basemap"
          maxZoom={19}
        />

        {boundaries && (
          <GeoJSON
            key={geoKey}
            data={boundaries}
            style={styleFor as never}
            onEachFeature={onEachFeature as never}
          />
        )}

        {layer === "vegetation" && Object.values(indicators).filter((p) => p.ndvi_sample && p.ndvi_mean != null).map((p) => (
          <CircleMarker key={p.name} center={[p.ndvi_sample!.lat, p.ndvi_sample!.lng]} radius={7}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: ndviColour(p.ndvi_mean), fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelectCounty(p.name) }}>
            <Tooltip>{p.name}: {p.ndvi_mean!.toFixed(2)}<br />{t("map_local_ndvi")}</Tooltip>
          </CircleMarker>
        ))}
        {/* JKUAT Conduit ground-intelligence marker */}
        <CircleMarker
          center={JKUAT}
          radius={9}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#006B3C", fillOpacity: 0.25 }}
          eventHandlers={{ click: onSelectStation }}
        />
        <CircleMarker
          center={JKUAT}
          radius={5}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#006B3C", fillOpacity: 1 }}
          eventHandlers={{ click: onSelectStation }}
        >
          <Tooltip direction="right" offset={[8, 0]} permanent className="afya-station-tooltip">
            <span style={{ fontWeight: 700, color: "#006B3C" }}>{stationLabel}</span>
            <br />
            <span style={{ fontSize: 10, color: "#68756f" }}>{stationSubLabel}</span>
          </Tooltip>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
