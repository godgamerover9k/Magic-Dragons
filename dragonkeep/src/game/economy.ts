import { IV_MAX } from "./types";
import type {
  Bakery,
  ContentPack,
  Dragon,
  FoodBatch,
  ProductionFormula,
  SaveGame,
  Species,
} from "./types";

export const HOUR_MS = 3_600_000;

export function speciesOf(pack: ContentPack, dragon: Dragon): Species | undefined {
  return pack.species[dragon.speciesId];
}

// --- Individual values -----------------------------------------------------

/**
 * What this dragon's IV is worth. A 0 contributes nothing; a 31 contributes the
 * full magnitude set in the content pack.
 */
export function ivBonus(
  pack: ContentPack,
  dragon: Dragon,
  affects: "production" | "growth",
): number {
  const magnitude =
    affects === "production"
      ? pack.iv.productionMagnitude
      : pack.iv.growthMagnitude;
  // Bent by the curve exponent, so the bottom of the range is nearly worthless
  // and the last few points carry most of the value.
  const curve = Math.max(pack.iv.curveExponent ?? 1, 0.01);
  return magnitude * Math.pow(ivOf(dragon) / IV_MAX, curve);
}

/** Reads the IV safely, since imported saves may predate it. */
export function ivOf(dragon: Dragon): number {
  return typeof dragon.iv === "number" ? dragon.iv : 0;
}

/**
 * Level and tier collapse into one number. A level 1 tier 1 dragon has power 1;
 * every tier step is worth `tierWeight` levels.
 */
export function powerOf(pack: ContentPack, dragon: Dragon): number {
  const weight = Math.max(pack.balance.power.tierWeight, 1);
  return Math.max(dragon.level, 1) * Math.pow(weight, Math.max(dragon.tier - 1, 0));
}

/**
 * coins/hr = base × (1 + IV bonus) × power ^ exponent
 *
 * Each dragon's output is set outright by its own baseProduction. The exponent
 * sits below 1, so power has diminishing returns and a heavily raised weak
 * dragon never overtakes a fresh strong one.
 */
export function coinsPerHour(pack: ContentPack, dragon: Dragon): number {
  const species = speciesOf(pack, dragon);
  if (!species) return 0;

  const exponent = species.productionOverrides?.exponent ?? pack.balance.production.exponent;
  const raw =
    species.baseProduction *
    (1 + ivBonus(pack, dragon, "production")) *
    Math.pow(powerOf(pack, dragon), exponent);

  return Math.max(0, Math.round(raw));
}

/**
 * Capacity reads the same power with a steeper exponent, so the hours a dragon
 * can be left alone grow as it is raised rather than shrink.
 */
export function coinCap(pack: ContentPack, dragon: Dragon): number {
  const species = speciesOf(pack, dragon);
  if (species?.coinCapacity && species.coinCapacity > 0)
    return Math.round(species.coinCapacity);

  if (!species) return 0;

  const hours = species.coinStorageHours ?? pack.balance.coinStorageHours;
  const raw =
    species.baseProduction *
    (1 + ivBonus(pack, dragon, "production")) *
    Math.max(hours, 0) *
    Math.pow(powerOf(pack, dragon), pack.balance.capacity.exponent);

  return Math.round(raw);
}

/** Hours a dragon can be left alone before it stops earning. */
export function hoursToFill(pack: ContentPack, dragon: Dragon): number {
  const rate = coinsPerHour(pack, dragon);
  return rate > 0 ? coinCap(pack, dragon) / rate : 0;
}

/** Milliseconds until this dragon stops earning, or null if it already has. */
export function timeUntilFull(
  pack: ContentPack,
  dragon: Dragon,
  now: number,
): number | null {
  const rate = coinsPerHour(pack, dragon);
  if (rate <= 0) return null;
  const remaining = coinCap(pack, dragon) - pendingCoins(pack, dragon, now);
  if (remaining <= 0) return null;
  return (remaining / rate) * HOUR_MS;
}

/** Coins a dragon has banked since it was last collected, capped. */
export function pendingCoins(
  pack: ContentPack,
  dragon: Dragon,
  now: number,
): number {
  const elapsed = Math.max(0, now - dragon.lastCollectedAt);
  const earned = (coinsPerHour(pack, dragon) * elapsed) / HOUR_MS;
  return Math.min(Math.floor(dragon.uncollectedCoins + earned), coinCap(pack, dragon));
}

// --- Levelling -------------------------------------------------------------

export function xpToNextLevel(
  pack: ContentPack,
  dragon: Dragon,
): number {
  const mult = speciesOf(pack, dragon)?.xpMultiplier ?? 1;
  const { levelXpBase, levelXpExponent } = pack.balance;
  return Math.round(levelXpBase * Math.pow(dragon.level, levelXpExponent) * mult);
}

/**
 * Food needed to carry a dragon to its next level, accounting for its IV. Null
 * when it is already at the ceiling.
 */
export function foodToNextLevel(pack: ContentPack, dragon: Dragon): number | null {
  if (isMaxLevel(pack, dragon)) return null;
  const missing = Math.max(xpToNextLevel(pack, dragon) - dragon.xp, 0);
  const perFood = pack.balance.xpPerFood * (1 + ivBonus(pack, dragon, "growth"));
  if (perFood <= 0) return null;
  return Math.max(1, Math.ceil(missing / perFood));
}

export function isMaxLevel(pack: ContentPack, dragon: Dragon): boolean {
  return dragon.level >= pack.balance.maxLevel;
}

/** Applies XP and rolls levels up. Returns a new dragon plus levels gained. */
export function grantXp(
  pack: ContentPack,
  dragon: Dragon,
  xp: number,
): { dragon: Dragon; levelsGained: number } {
  const scaled = Math.round(xp * (1 + ivBonus(pack, dragon, "growth")));
  let next: Dragon = { ...dragon, xp: dragon.xp + scaled };
  let levelsGained = 0;
  let guard = 0;
  while (!isMaxLevel(pack, next) && guard++ < 10_000) {
    const need = xpToNextLevel(pack, next);
    if (next.xp < need) break;
    next = { ...next, level: next.level + 1, xp: next.xp - need };
    levelsGained++;
  }
  if (isMaxLevel(pack, next)) next = { ...next, xp: 0 };
  return { dragon: next, levelsGained };
}

// --- Merging ---------------------------------------------------------------

/** A dragon's own merge costs, or the global default. */
export function mergeCostsFor(pack: ContentPack, speciesId: string): number[] {
  const own = pack.species[speciesId]?.mergeCosts;
  return own && own.length > 0 ? own : pack.balance.mergeCosts;
}

export function maxTierFor(pack: ContentPack, speciesId: string): number {
  return pack.species[speciesId]?.maxTier ?? pack.balance.maxTier;
}

export function mergeCost(pack: ContentPack, dragon: Dragon): number | null {
  if (dragon.tier >= maxTierFor(pack, dragon.speciesId)) return null;
  const costs = mergeCostsFor(pack, dragon.speciesId);
  return costs[dragon.tier - 1] ?? costs[costs.length - 1] ?? 2;
}

/**
 * How many tier 1 dragons one dragon of `tier` is made of. Because each step
 * consumes duplicates *of the tier below*, the cost compounds: with costs of
 * 2, 3, 4 a tier 4 dragon is 3 × 4 × 5 = 60 tier 1 dragons.
 */
export function tierOneCost(pack: ContentPack, speciesId: string, tier: number): number {
  const costs = mergeCostsFor(pack, speciesId);
  let total = 1;
  for (let step = 0; step < tier - 1; step++) {
    const cost = costs[step] ?? costs[costs.length - 1] ?? 2;
    total *= cost + 1;
  }
  return total;
}

/** Accent colour for a dragon, falling back to a neutral tone. */
export function colorOf(pack: ContentPack, speciesId: string): string {
  return pack.species[speciesId]?.color || "#8A93A6";
}

/** Duplicates that may legally be consumed to raise this dragon's tier. */
export function eligibleFodder(dragons: Dragon[], target: Dragon): Dragon[] {
  return dragons.filter(
    (d) =>
      d.id !== target.id &&
      d.speciesId === target.speciesId &&
      d.tier === target.tier &&
      !d.locked,
  );
}

// --- Food and bakeries -----------------------------------------------------

/** Seconds an egg of this species takes to hatch. */
export function incubationSeconds(pack: ContentPack, speciesId: string): number {
  const species = pack.species[speciesId];
  return species?.incubationSeconds ?? pack.balance.defaultIncubationSeconds;
}

export function batchById(pack: ContentPack, id: string | null): FoodBatch | null {
  if (!id) return null;
  return pack.balance.foodBatches.find((b) => b.id === id) ?? null;
}

export type OvenState = "idle" | "baking" | "ready";

export function ovenState(bakery: Bakery, now: number): OvenState {
  if (!bakery.batchId) return "idle";
  return now >= bakery.readyAt ? "ready" : "baking";
}

/**
 * Exponential. Each oven costs a fixed multiple of the one before, so a third
 * or fourth oven is a genuine commitment rather than a rounding error.
 */
export function nextBakeryCost(pack: ContentPack, owned: number): number {
  return Math.round(
    pack.balance.bakeryCost * Math.pow(pack.balance.bakeryCostGrowth, owned),
  );
}

/** Food waiting to be collected across every oven. */
export function readyFood(pack: ContentPack, save: SaveGame, now: number): number {
  return save.bakeries.reduce((sum, oven) => {
    if (ovenState(oven, now) !== "ready") return sum;
    return sum + (batchById(pack, oven.batchId)?.food ?? 0);
  }, 0);
}

/**
 * Polynomial. The nth extra perch costs base × n ^ exponent, so successive
 * perches cost more in absolute terms while the multiple between them falls
 * away. A roost can always be extended, it just stops being free.
 */
export function nextRoostSlotCost(pack: ContentPack, capacity: number): number {
  const { roostSlotCost, roostSlotCostExponent, roostCapacity } = pack.balance;
  const n = Math.max(0, capacity - roostCapacity) + 1;
  return Math.round(roostSlotCost * Math.pow(n, roostSlotCostExponent));
}

// --- Formatting ------------------------------------------------------------

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (abs >= 10_000) return (n / 1000).toFixed(1) + "K";
  return Math.round(n).toLocaleString("en-US");
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "ready";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
