import { isWithin } from "./taxonomy";
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
// An `exclusive` rule throws away everything else and IS the pool — that is how
// you write a guaranteed result. Among exclusives, highest priority wins.
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
  /** Set when an exclusive rule took over the pool. */
  exclusiveRule: BreedingRule | null;
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
  rule: BreedingRule,
  p1: Dragon,
  p2: Dragon,
  discovered: SpeciesId[],
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
  if (c.onlyIfUndiscovered?.some((id) => discovered.includes(id))) return false;
  if (c.requiresDiscovered?.some((id) => !discovered.includes(id))) return false;
  return true;
}

export function buildPool(
  pack: ContentPack,
  p1: Dragon,
  p2: Dragon,
  discovered: SpeciesId[],
): BreedingPool {
  const applied: BreedingRule[] = [];
  let exclusive: BreedingRule | null = null;

  for (const rule of pack.breedingRules) {
    if (!rule.enabled) continue;
    if (!ruleMatchesPair(pack, rule, p1, p2)) continue;
    if (!conditionsMet(rule, p1, p2, discovered)) continue;
    applied.push(rule);
    if (rule.exclusive) {
      if (!exclusive || rule.priority > exclusive.priority) exclusive = rule;
    }
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

  if (exclusive) {
    for (const o of exclusive.outcomes) add(o.speciesId, o.weight, exclusive.label);
  } else {
    const pw = pack.balance.parentWeight;
    add(p1.speciesId, pw, "Parent");
    add(p2.speciesId, pw, "Parent");
    for (const rule of applied) {
      for (const o of rule.outcomes) add(o.speciesId, o.weight, rule.label);
    }
  }

  const entries = [...totals.values()].sort((a, b) => b.weight - a.weight);
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);

  return {
    entries,
    totalWeight,
    exclusiveRule: exclusive,
    appliedRules: applied,
  };
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
