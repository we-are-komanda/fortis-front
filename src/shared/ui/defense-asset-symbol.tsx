import type { SVGProps } from "react";
import { defenseAssetSymbols, type DefenseAssetSymbolId } from "@/shared/config/defense-asset-symbols";

export function DefenseAssetSymbol({ symbolId, ...props }: SVGProps<SVGSVGElement> & { symbolId: DefenseAssetSymbolId }) {
  const symbol = defenseAssetSymbols[symbolId];
  return (
    <svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" data-tactical-symbol={symbolId} aria-hidden="true" {...props}>
      <path d={symbol.path} />
      {symbol.head && <path d={symbol.head} fill="currentColor" strokeWidth="1" />}
    </svg>
  );
}
