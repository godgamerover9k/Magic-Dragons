import { IV_MAX } from "./types";
import type {
  Bakery,
  ContentPack,
  Dragon,
  ProductionFormula,
  Rarity,
  Species,
} from "./types";

export const HOUR_MS = 3_600_000;

export function speciesOf(pack: ContentPack, dragon: Dragon): Species | undefined {
  return pack.species[dragon.speciesId];
}

export function rarityOf(pack: ContentPack, dragon: Dragon): Rarity | undefined {
  const species = speciesOf(pack, dragon);
  return species ? pack.rarities[species.rarityId] : undefined;
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
  return magnitude * (ivOf(dragon) / IV_MAX);
}

/** Reads the IV safely, since imported saves may predate it. */
export function ivOf(dragon: Dragon): number {
  return typeof dragon.iv === "number" ? dragon.iv : 0;
}

function formulaFor(pack: ContentPack, species: Species): ProductionFormula {
  return { ...pack.balance.production, ...(species.productionOverrides ?? {}) };
}

/**
 * coins/hr = base
 *          × rarity multiplier
 *          × (1 + levelCoefficient × (level − 1) ^ levelExponent)
 *          × tierMultiplier ^ (tier − 1)
 *          × (1 + individual production bonus)
 */
export function coinsPerHour(pack: ContentPack, dragon: Dragon): number {
  const species = speciesOf(pack, dragon);
  const rarity = rarityOf(pack, dragon);
  if (!species || !rarity) return 0;
  const f = formulaFor(pack, species);

  const levelTerm =
    1 + f.levelCoefficient * Math.pow(Math.max(dragon.level - 1, 0), f.levelExponent);
  const tierTerm = Math.pow(f.tierMultiplier, Math.max(dragon.tier - 1, 0));
  const traitTerm = 1 + ivBonus(pack, dragon, "production");

  const raw =
    species.baseProduction *
    rarity.productionMultiplier *
    levelTerm *
    tierTerm *
    traitTerm;

  return Math.max(0, Math.round(raw));
}

export function coinCap(pack: ContentPack, dragon: Dragon): number {
  return Math.round(coinsPerHour(pack, dragon) * pack.balance.coinStorageHours);
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
  const rarity = rarityOf(pack, dragon);
  const mult = rarity?.xpMultiplier ?? 1;
  const { levelXpBase, levelXpExponent } = pack.balance;
  return Math.round(levelXpBase * Math.pow(dragon.level, levelXpExponent) * mult);
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

export function mergeCost(pack: ContentPack, dragon: Dragon): number | null {
  const rarity = rarityOf(pack, dragon);
  if (!rarity) return null;
  if (dragon.tier >= rarity.maxTier) return null;
  const index = dragon.tier - 1;
  return rarity.mergeCosts[index] ?? rarity.mergeCosts[rarity.mergeCosts.length - 1] ?? 2;
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

export function bakeryTier(pack: ContentPack, level: number) {
  const tiers = pack.balance.bakeryTiers;
  return tiers.find((t) => t.level === level) ?? tiers[tiers.length - 1];
}

export function pendingFood(
  pack: ContentPack,
  bakery: Bakery,
  now: number,
): number {
  const tier = bakeryTier(pack, bakery.level);
  if (!tier) return 0;
  const elapsed = Math.max(0, now - bakery.lastCollectedAt);
  const baked = (tier.foodPerHour * elapsed) / HOUR_MS;
  return Math.min(Math.floor(bakery.storedFood + baked), tier.storage);
}

export function nextBakeryUpgrade(pack: ContentPack, bakery: Bakery) {
  return pack.balance.bakeryTiers.find((t) => t.level === bakery.level + 1) ?? null;
}

export function nextRoostSlotCost(pack: ContentPack, capacity: number): number {
  const { roostSlotCost, roostSlotCostGrowth, roostCapacity } = pack.balance;
  const bought = Math.max(0, capacity - roostCapacity);
  return Math.round(roostSlotCost * Math.pow(roostSlotCostGrowth, bought));
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
