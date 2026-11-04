// Redrawn from МО РФ, Боевой устав, часть 3 (2005), приложение 3, с. 397, 399–400.
// Source scans and the product-to-class mapping are documented in knowledge-base.
export const defenseAssetSymbols = {
  "aa-gun": { label: "Зенитное орудие малого калибра", path: "M16 6V28 M12 20V24 M20 20V24 M12 28H20", head: "M16 3L13 11L16 9L19 11Z" },
  "aa-self-propelled": { label: "Зенитная самоходная установка — общее обозначение", path: "M3 16L16 9L29 16L16 23Z M8 16H24 M17 12H21 M17 20H21", head: "M7 16L13 13L11 16L13 19Z" },
  "aa-machine-gun": { label: "Зенитная пулемётная установка", path: "M16 6V29 M8 29A8 8 0 0 1 24 29", head: "M16 3L13 11L16 9L19 11Z" },
  "air-surveillance-radar": { label: "Радиолокационная станция разведки воздушных целей", path: "M7 28L16 12L25 28Z M16 12V6 M5 6H27 M5 3L3 9 M8 3L6 9 M26 3L24 9 M29 3L27 9", head: "" },
  unknown: { label: "Условный знак не задан", path: "M12 11C12 6 21 6 21 12C21 15 16 15 16 20 M16 25V26", head: "" },
} as const;

export type DefenseAssetSymbolId = keyof typeof defenseAssetSymbols;

const sstSymbols: Record<string, DefenseAssetSymbolId> = {
  "sst-zu-23m1": "aa-gun",
  "sst-zu-23m-1m-ural": "aa-self-propelled",
  "sst-anklav": "aa-machine-gun",
  "sst-zpk-yakb": "aa-machine-gun",
  "sst-tpu-12-7": "aa-machine-gun",
  "sst-bekas": "air-surveillance-radar",
};

export function getDefenseAssetSymbolId(assetId?: string): DefenseAssetSymbolId {
  return assetId ? sstSymbols[assetId] ?? "unknown" : "unknown";
}
