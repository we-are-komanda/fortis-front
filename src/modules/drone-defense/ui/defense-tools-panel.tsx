"use client";

import { getBuildAssetForCatalogGroup } from "@/modules/drone-defense/domain/echelon-build-assets";
import { DefenseToolIcon } from "@/modules/drone-defense/ui/defense-tool-icon";
import type { AssetCatalogItem } from "@/shared/lib/defense-project";
import type { DefenseProject } from "@/shared/types/defense-project";
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

type DefenseToolsPanelProps = {
  assets: AssetCatalogItem[];
  projectAssets: DefenseProject["assetLibrary"];
  selectedToolId: string | null;
  selectedObjectAssetId?: string;
  onSelectTool: (asset: AssetCatalogItem) => void;
  onOpenCoordinates: (asset: AssetCatalogItem) => void;
  onDragAsset: (asset: AssetCatalogItem, event: ReactDragEvent<HTMLDivElement>) => void;
  onPointerDragAsset: (asset: AssetCatalogItem, event: ReactPointerEvent<HTMLDivElement>) => void;
  onRemoveTool: (asset: AssetCatalogItem) => void;
};

export function DefenseToolsPanel({
  assets,
  projectAssets,
  selectedToolId,
  selectedObjectAssetId,
  onSelectTool,
  onOpenCoordinates,
  onDragAsset,
  onPointerDragAsset,
  onRemoveTool,
}: DefenseToolsPanelProps) {
  if (assets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
        Нет средств защиты
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {assets.map((assetItem) => {
        const projectAsset = projectAssets.find((asset) => asset.id === assetItem.assetId);
        const primaryGroupId = projectAsset?.mapCatalogGroupIds?.[0];
        const buildAsset = primaryGroupId ? getBuildAssetForCatalogGroup(primaryGroupId) : null;
        const installedCount = assetItem.placedCount;
        const disabledReason = undefined;

        const imageUrl = buildAsset?.imageUrl ?? assetItem.imageUrl;
        const previewImageUrl = buildAsset?.previewImageUrl ?? assetItem.imageUrl;

        return (
          <DefenseToolIcon
            key={assetItem.assetId}
            assetId={assetItem.assetId}
            name={assetItem.title}
            protectionType={assetItem.protectionType}
            categoryLabel={assetItem.categoryLabel}
            rangeLabel={assetItem.rangeLabel}
            priceLabel={assetItem.priceLabel}
            coverageLabel={assetItem.coverageLabel}
            compoundProfile={assetItem.compoundProfile}
            placementType={assetItem.placementType}
            imageUrl={imageUrl}
            previewImageUrl={previewImageUrl}
            installedCount={installedCount}
            maxQuantity={assetItem.maxQuantity}
            disabledReason={disabledReason}
            canRemove={assetItem.assetId === selectedObjectAssetId}
            isSelected={selectedToolId === assetItem.assetId}
            onSelect={() => onSelectTool(assetItem)}
            onOpenCoordinates={() => onOpenCoordinates(assetItem)}
            onDragAsset={(event) => onDragAsset(assetItem, event)}
            onPointerDragAsset={(event) => onPointerDragAsset(assetItem, event)}
            onRemove={() => onRemoveTool(assetItem)}
          />
        );
      })}
    </div>
  );
}
