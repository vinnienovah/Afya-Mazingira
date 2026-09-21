"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap } from "react-leaflet";
import type { Layer, PathOptions, LeafletKeyboardEvent } from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { RISK_META } from "@/lib/afya/constants";
import type { CountyFeature } from "@/lib/afya/map-data";
import "leaflet/dist/leaflet.css";

const JKUAT: [number, number] = [-1.0931, 37.0149];

export type MapLayerKey = "outlook" | "thermal" | "rain" | "vegetation" | "lst";

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
  mode: "summary" | "surface";
  timeIdx: number;
  selectedCounty: string | null;
  onSelectCounty: (name: string | null) => void;
  onSelectStation: () => void;
  stationLabel: string;
  stationSubLabel: string;
  lang: string;
}

function colourFor(layer: MapLayerKey, p: CountyFeature["properties"] | undefined, timeIdx: number): string {
  if (!p) return "#c9d3cd";

  if (layer === "outlook") {
    const cat = p.outlook_hours?.[timeIdx]?.category ?? p.outlook_category;
    return RISK_META[cat as keyof typeof RISK_META]?.color ?? "#9ca3af";
  }
  if (layer === "thermal" || layer === "lst") {
    const t = p.lst_c ?? 30;
    if (t < 28) return "#DBEAFE";
    if (t < 31) return "#93C5FD";
    if (t < 34) return "#F2B705";
    if (t < 37) return "#E27832";
    return "#C62828";
  }
  if (layer === "rain") {
    const r = p.rain_24h_mm;
    if (r < 0.5) return "#EAF4FA";
    if (r < 2) return "#93C5FD";
    if (r < 6) return "#3786B5";
    if (r < 12) return "#1E5A8A";
    return "#0F3A5C";
  }
  // vegetation
  const n = p.ndvi_mean ?? 0;
  if (n < 0.2) return "#D4B896";
  if (n < 0.35) return "#A8C686";
  if (n < 0.5) return "#5B9E6B";
  if (n < 0.65) return "#1A6B3C";
  return "#0D4625";
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
  boundaries, indicators, layer, mode, timeIdx,
  selectedCounty, onSelectCounty, onSelectStation,
  stationLabel, stationSubLabel, lang,
}: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  // Keep a ref so the style callback always sees current values
  const stateRef = useRef({ layer, mode, timeIdx, selectedCounty, hovered });
  useEffect(() => {
    stateRef.current = { layer, mode, timeIdx, selectedCounty, hovered };
  });

  const styleFor = useMemo(
    () => (feature?: Feature<Geometry, CountyProps>): PathOptions => {
      const name = feature?.properties?.name ?? "";
      const p = indicators[name];
      const s = stateRef.current;
      const isSelected = s.selectedCounty === name;
      const isHovered = s.hovered === name;
      return {
        fillColor: colourFor(s.layer, p, s.timeIdx),
        fillOpacity: p ? (s.mode === "surface" ? 0.55 : isSelected ? 0.85 : isHovered ? 0.78 : 0.68) : 0.25,
        color: isSelected ? "#17211C" : "#ffffff",
        weight: isSelected ? 2.5 : isHovered ? 2 : 1,
        opacity: 1,
      };
    },
    [indicators],
  );

  // Re-render styles when controls change
  const geoKey = `${layer}-${mode}-${timeIdx}-${selectedCounty ?? "none"}-${hovered ?? "none"}`;

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
      const cat = p
        ? (p.outlook_hours?.[timeIdx]?.category ?? p.outlook_category)
        : (lang === "sw" ? "hakuna data" : "no data");
      lyr.bindTooltip(
        `<strong>${name}</strong><br/><span style="font-size:11px">${cat}</span>`,
        { sticky: true, direction: "top", className: "afya-tooltip" },
      );
    },
    [indicators, onSelectCounty, selectedCounty, timeIdx, lang],
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
