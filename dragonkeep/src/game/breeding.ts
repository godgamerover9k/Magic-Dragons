import { branchUnder, isWithin } from "./taxonomy";
import type {
  BreedingRule,
  ContentPack,
  Dragon,
  Matcher,
  SpeciesId,
} from "./types";

// ---------------------------------------------------------------------------
// One breed = one weighted pool.
//
//   1. Both parents are added to the pool at balance.parentWeight.
//   2. Every enabled rule whose matchers fit the pair adds its outcomes.
//   3. Duplicate species have their weights summed.
//   4. One roll against the summed total picks the winner.
//
// Rules only ever ADD weight. Nothing can remove the parents from the pool, so
// no pairing is ever a certainty and every breed keeps some chance of returning
// a parent.
// ---------------------------------------------------------------------------

export interface PoolEntry {
  speciesId: SpeciesId;
  weight: number;
  /** Which rules contributed, for the admin preview. */
  sources: string[];
}

export interface BreedingPool {
  entries: PoolEntry[];
  totalWeight: number;
  appliedRules: BreedingRule[];
}

export function matches(
  pack: ContentPack,
  matcher: Matcher,
  dragon: Dragon,
): boolean {
  const species = pack.species[dragon.speciesId];
  if (!species) return false;
  switch (matcher.kind) {
    case "any":
      return true;
    case "species":
      return species.id === matcher.speciesId;
    case "tag":
      return species.tags.includes(matcher.tag);
    case "taxon":
      return matcher.includeDescendants
        ? isWithin(pack, species.taxonId, matcher.taxonId)
        : species.taxonId === matcher.taxonId;
  }
}

/** Rules are unordered: (a,b) and (b,a) both count as a match. */
export function ruleMatchesPair(
  pack: ContentPack,
  rule: BreedingRule,
  p1: Dragon,
  p2: Dragon,
): boolean {
  const forward =
    matches(pack, rule.a, p1) && matches(pack, rule.b, p2);
  const reverse =
    matches(pack, rule.a, p2) && matches(pack, rule.b, p1);
  return forward || reverse;
}

export function conditionsMet(
  pack: ContentPack,
  rule: BreedingRule,
  p1: Dragon,
  p2: Dragon,
): boolean {
  const c = rule.conditions;
  if (!c) return true;
  if (c.minTier !== undefined && (p1.tier < c.minTier || p2.tier < c.minTier))
    return false;
  if (
    c.minLevel !== undefined &&
    (p1.level < c.minLevel || p2.level < c.minLevel)
  )
    return false;
  if (c.differentSpecies && p1.speciesId === p2.speciesId) return false;
  if (c.minIv !== undefined && ((p1.iv ?? 0) < c.minIv || (p2.iv ?? 0) < c.minIv))
    return false;
  if (c.maxIv !== undefined && ((p1.iv ?? 0) > c.maxIv || (p2.iv ?? 0) > c.maxIv))
    return false;
  if (c.minIvEither !== undefined && Math.max(p1.iv ?? 0, p2.iv ?? 0) < c.minIvEither)
    return false;
  if (c.maxIvEither !== undefined && Math.min(p1.iv ?? 0, p2.iv ?? 0) > c.maxIvEither)
    return false;
  if (c.differentBranchUnder !== undefined) {
    const s1 = pack.species[p1.speciesId];
    const s2 = pack.species[p2.speciesId];
    if (!s1 || !s2) return false;
    const b1 = branchUnder(pack, s1.taxonId, c.differentBranchUnder);
    const b2 = branchUnder(pack, s2.taxonId, c.differentBranchUnder);
    // Both must be inside it, and in different sub-branches of it.
    if (!b1 || !b2 || b1 === b2) return false;
  }
  return true;
}

/**
 * A throwaway dragon for inspecting a pool without owning anything. Used by the
 * odds calculator in Admin.
 */
export function probeDragon(
  speciesId: SpeciesId,
  opts: { tier?: number; level?: number; iv?: number } = {},
): Dragon {
  return {
    id: `probe_${speciesId}_${opts.tier ?? 1}_${opts.iv ?? 0}`,
    speciesId,
    nickname: null,
    tier: opts.tier ?? 1,
    level: opts.level ?? 1,
    xp: 0,
    bornAt: 0,
    parentIds: null,
    iv: opts.iv ?? 0,
    locked: false,
    favorite: false,
    lastCollectedAt: 0,
    uncollectedCoins: 0,
    notes: "",
    custom: {},
  };
}

export function buildPool(
  pack: ContentPack,
  p1: Dragon,
  p2: Dragon,
): BreedingPool {
  const applied: BreedingRule[] = [];

  for (const rule of pack.breedingRules) {
    if (!rule.enabled) continue;
    if (!ruleMatchesPair(pack, rule, p1, p2)) continue;
    if (!conditionsMet(pack, rule, p1, p2)) continue;
    applied.push(rule);
  }

  const totals = new Map<SpeciesId, PoolEntry>();
  const add = (speciesId: SpeciesId, weight: number, source: string) => {
    if (weight <= 0) return;
    const species = pack.species[speciesId];
    if (!species || !species.obtainable) return;
    const existing = totals.get(speciesId);
    if (existing) {
      existing.weight += weight;
      if (!existing.sources.includes(source)) existing.sources.push(source);
    } else {
      totals.set(speciesId, { speciesId, weight, sources: [source] });
    }
  };

  const pw = pack.balance.parentWeight;
  add(p1.speciesId, pw, "Parent");
  add(p2.speciesId, pw, "Parent");
  for (const rule of applied) {
    for (const o of rule.outcomes) add(o.speciesId, o.weight, rule.label);
  }

  const entries = [...totals.values()].sort((a, b) => b.weight - a.weight);
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  return { entries, totalWeight, appliedRules: applied };
}

/** Picks an entry. `roll` is 0-1; injectable so tests stay deterministic. */
export function rollPool(pool: BreedingPool, roll: number): SpeciesId | null {
  if (pool.totalWeight <= 0 || pool.entries.length === 0) return null;
  let cursor = Math.min(Math.max(roll, 0), 0.999999) * pool.totalWeight;
  for (const entry of pool.entries) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.speciesId;
  }
  return pool.entries[pool.entries.length - 1].speciesId;
}

export function chanceOf(pool: BreedingPool, speciesId: SpeciesId): number {
  if (pool.totalWeight <= 0) return 0;
  const entry = pool.entries.find((e) => e.speciesId === speciesId);
  return entry ? entry.weight / pool.totalWeight : 0;
}
