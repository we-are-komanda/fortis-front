// Fictional rules for game balance. These values are not equipment specifications.
export const defaultGameSettings = Object.freeze({
  intervalMs: 5000,
  reactionMs: 2000,
  magazineSize: 6,
  ammunition: 60,
  reloadMs: 15000,
  maxTargets: 1,
});
export type GameSettings = { [K in keyof typeof defaultGameSettings]: number };

export const gameSettingLimits: Record<keyof GameSettings, readonly [number, number]> = {
  intervalMs: [1000, 60000], reactionMs: [0, 120000], magazineSize: [1, 1000],
  ammunition: [0, 10000], reloadMs: [0, 600000], maxTargets: [1, 16],
};

export function resolveGameSettings(value: unknown): GameSettings {
  if (value === undefined) return { ...defaultGameSettings };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные игровые параметры размещения.");
  const settings = value as GameSettings;
  for (const key of Object.keys(gameSettingLimits) as (keyof GameSettings)[]) {
    const [min, max] = gameSettingLimits[key];
    if (!Number.isInteger(settings[key]) || settings[key] < min || settings[key] > max) {
      throw new Error(`Некорректный игровой параметр ${key}: допустимо целое число от ${min} до ${max}.`);
    }
  }
  return { intervalMs: settings.intervalMs, reactionMs: settings.reactionMs, magazineSize: settings.magazineSize,
    ammunition: settings.ammunition, reloadMs: settings.reloadMs, maxTargets: settings.maxTargets };
}
