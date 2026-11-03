"use client";

import { defenseAssetSymbols, getDefenseAssetSymbolId } from "@/shared/config/defense-asset-symbols";
import { DefenseAssetSymbol } from "@/shared/ui/defense-asset-symbol";
import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import type { EchelonMapPlacement } from "@/modules/drone-defense/domain/echelon-map-model";

export type MapMarkerState = "default" | "hover" | "selected" | "disabled" | "warning" | "conflict" | "inactive";

export function getAssetMarkerIcon(placement: EchelonMapPlacement) {
  return <DefenseAssetSymbol symbolId={getDefenseAssetSymbolId(placement.markerAssetId)} />;
}

export function getMarkerState(placement: EchelonMapPlacement, isHovered: boolean): MapMarkerState {
  if (placement.isSelected) return "selected";
  if (isHovered) return "hover";
  return "default";
}

export function shouldShowLabel({
  zoom,
  isSelected,
  isHovered,
}: {
  zoom: number;
  isSelected: boolean;
  isHovered: boolean;
}) {
  return isSelected || isHovered || zoom >= 10.5;
}

type MapObjectMarkerProps = {
  placement: EchelonMapPlacement;
  x: number;
  y: number;
  zoom: number;
  layerLabel?: string;
  isHovered: boolean;
  onSelect: (placement: EchelonMapPlacement) => void;
  onDoubleClick: (placement: EchelonMapPlacement) => void;
  onHover: (placement: EchelonMapPlacement | null) => void;
};

export function MapObjectMarker({
  placement,
  x,
  y,
  zoom,
  layerLabel,
  isHovered,
  onSelect,
  onDoubleClick,
  onHover,
}: MapObjectMarkerProps) {
  const pendingClickRef = useRef<number | null>(null);
  const state = getMarkerState(placement, isHovered);
  const symbol = defenseAssetSymbols[getDefenseAssetSymbolId(placement.markerAssetId)];
  const showLabel = shouldShowLabel({ zoom, isSelected: Boolean(placement.isSelected), isHovered });
  const markerSize = placement.isSelected ? 48 : 44;
  const markerBadge = placement.qty > 1 ? placement.qty : null;
  const markerStyle = {
    left: x,
    top: y,
    width: markerSize,
    height: markerSize,
    transform: "translate(-50%, -50%)",
  } as CSSProperties;
  const clearPendingClick = useCallback(() => {
    if (pendingClickRef.current === null) return;
    window.clearTimeout(pendingClickRef.current);
    pendingClickRef.current = null;
  }, []);

  useEffect(() => clearPendingClick, [clearPendingClick]);

  return (
    <button
      type="button"
      className={`pointer-events-auto absolute z-20 grid place-items-center rounded-md border bg-white/95 text-black shadow-sm outline-none transition duration-150 hover:scale-[1.08] focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
        placement.isSelected ? "border-blue-600 ring-2 ring-blue-600/30" : "border-slate-300"
      }`}
      style={markerStyle}
      aria-label={`${placement.label}, ${layerLabel ?? placement.layerId}, ${placement.qty} ед.`}
      title={`${placement.label} · ${symbol.label}${layerLabel ? ` · ${layerLabel}` : ""}`}
      data-testid={`map-object-marker-${placement.sourcePlacementId}`}
      data-marker-state={state}
      data-marker-category={placement.markerCategory ?? "infrastructure"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail > 1) {
          clearPendingClick();
          return;
        }
        clearPendingClick();
        pendingClickRef.current = window.setTimeout(() => {
          pendingClickRef.current = null;
          onSelect(placement);
        }, 180);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        clearPendingClick();
        onDoubleClick(placement);
      }}
      onMouseEnter={() => onHover(placement)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="grid place-items-center" aria-hidden="true">
        {getAssetMarkerIcon(placement)}
      </span>
      {markerBadge ? (
        <span className="markerBadge absolute -right-1.5 -top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-slate-950 px-1 text-[10px] font-black leading-none text-white ring-1 ring-white/80">
          {markerBadge}
        </span>
      ) : null}
      {showLabel ? (
        <span className="pointer-events-none absolute left-full top-1/2 ml-2 max-w-44 -translate-y-1/2 truncate rounded-full bg-slate-950/92 px-2.5 py-1 text-xs font-semibold text-white shadow-md shadow-slate-950/25">
          {placement.label}
        </span>
      ) : null}
    </button>
  );
}
