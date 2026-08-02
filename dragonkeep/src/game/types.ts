// ---------------------------------------------------------------------------
// Dragonkeep — core data model
//
// Two things live side by side:
//   ContentPack — the game's DESIGN (taxonomy, species, rarities, rules, balance)
//   SaveGame    — one PLAYER's progress (their dragons, coins, buildings)
//
// A ContentPack is fully editable in Admin mode and can be downloaded as JSON.
// ---------------------------------------------------------------------------

export type TaxonId = string;
export type SpeciesId = string;
export type RarityId = string;

// --- Taxonomy --------------------------------------------------------------
// An arbitrary-depth tree. Any node can have children; depth is not fixed and
// rank names are just labels, so you can invent your own hierarchy.

export interface Taxon {
  id: TaxonId;
  name: string;
  parentId: TaxonId | null;
  /** Free-form label for this level, e.g. "Order", "Clade", "Bloodline". */
  rank?: string;
  description?: string;
  custom: Record<string, unknown>;
}

// --- Individual values -----------------------------------------------------
// Each dragon rolls a single value at birth, 0-31 inclusive, matching Pokémon's
// range. What that number is worth is content, not code.

export const IV_MIN = 0;
export const IV_MAX = 31;

export interface IvConfig {
  /** What the number is called in the interface. */
  name: string;
  description: string;
  /** Bonus to coins per hour at a perfect 31. 0.25 means +25% at 31, +0% at 0. */
  productionMagnitude: number;
  /** Bonus to xp from food at a perfect 31. */
  growthMagnitude: number;
}

// --- Rarity ----------------------------------------------------------------

export interface Rarity {
  id: RarityId;
  name: string;
  /** Sort order, low = common. */
  order: number;
  /** Hex colour used throughout the UI for this rarity. */
  color: string;
  /** Multiplies coin production. */
  productionMultiplier: number;
  /** Multiplies XP required per level. */
  xpMultiplier: number;
  /** Duplicates consumed to merge up one tier. Index 0 = tier 1 -> 2. */
  mergeCosts: number[];
  /** Highest tier a dragon of this rarity can reach. */
  maxTier: number;
}

// --- Species (the template) ------------------------------------------------

export interface Species {
  id: SpeciesId;
  name: string;
  taxonId: TaxonId;
  rarityId: RarityId;
  /** Free-form labels for breeding rules and filtering, e.g. "nocturnal". */
  tags: string[];
  /** Coins per hour at tier 1, level 1, before any multipliers. */
  baseProduction: number;
  /**
   * Seconds an egg of this species takes to hatch. Falls back to
   * balance.defaultIncubationSeconds when not set.
   */
  incubationSeconds?: number;
  /** Shown in the Codex. */
  description: string;
  /** Buyable in the Market; 0 or undefined means not for sale. */
  marketPrice?: number;
  /** Can appear as a breeding outcome / be obtained at all. */
  obtainable: boolean;
  /** Per-species overrides of the production formula. */
  productionOverrides?: Partial<ProductionFormula>;
  custom: Record<string, unknown>;
}

// --- Breeding --------------------------------------------------------------
// Every breed builds ONE weighted pool. Parents are always in the pool by
// default; rules add more entries. Weights are summed and one roll decides.

export type Matcher =
  | { kind: "species"; speciesId: SpeciesId }
  | { kind: "taxon"; taxonId: TaxonId; includeDescendants: boolean }
  | { kind: "tag"; tag: string }
  | { kind: "any" };

export interface Outcome {
  speciesId: SpeciesId;
  weight: number;
}

export interface RuleConditions {
  /** Both parents must be at least this tier. */
  minTier?: number;
  /** Both parents must be at least this level. */
  minLevel?: number;
  /** Only fires while these species are still undiscovered. */
  onlyIfUndiscovered?: SpeciesId[];
  /** Only fires once these species have been discovered. */
  requiresDiscovered?: SpeciesId[];
}

export interface BreedingRule {
  id: string;
  label: string;
  /** Matched in either order: (a,b) or (b,a). */
  a: Matcher;
  b: Matcher;
  outcomes: Outcome[];
  conditions?: RuleConditions;
  /**
   * If true, this rule REPLACES the whole pool instead of adding to it.
   * Use for guaranteed results. Highest priority exclusive rule wins.
   */
  exclusive: boolean;
  priority: number;
  enabled: boolean;
  notes?: string;
}

// --- Balance ---------------------------------------------------------------

export interface ProductionFormula {
  /** coins/hr = base * rarityMult * levelTerm * tierMult^(tier-1) * traitBonus */
  levelCoefficient: number;
  levelExponent: number;
  tierMultiplier: number;
}

export interface FoodType {
  id: string;
  name: string;
  /** Food units required to cook one portion. */
  foodCost: number;
  /** XP granted per portion fed. */
  xp: number;
  /** Minimum bakery level required to cook this. */
  unlocksAtBakeryLevel: number;
}

export interface BakeryTier {
  level: number;
  /** Coin cost to build (level 1) or upgrade to this level. */
  cost: number;
  /** Food units produced per hour. */
  foodPerHour: number;
  /** Uncollected food is capped at this. */
  storage: number;
}

export interface BalanceConfig {
  startingCoins: number;
  startingFood: number;
  /** Species handed out on a fresh save. */
  startingSpecies: SpeciesId[];
  roostCapacity: number;
  roostSlotCost: number;
  roostSlotCostGrowth: number;

  production: ProductionFormula;
  /** Uncollected coins per dragon are capped at this many hours of output. */
  coinStorageHours: number;

  levelXpBase: number;
  levelXpExponent: number;
  maxLevel: number;

  /** Weight each parent contributes to every breeding pool. */
  parentWeight: number;
  /** Fallback incubation for species that do not set their own. */
  defaultIncubationSeconds: number;

  maxBakeries: number;
  /** Each additional bakery costs this much more than the last. */
  bakeryCostGrowth: number;
  foodTypes: FoodType[];
  bakeryTiers: BakeryTier[];
}

// --- Content pack ----------------------------------------------------------

export interface ContentPack {
  /** Bumped when the shape changes, so old saves can be migrated. */
  schemaVersion: number;
  name: string;
  taxa: Record<TaxonId, Taxon>;
  rarities: Record<RarityId, Rarity>;
  species: Record<SpeciesId, Species>;
  /** What the one IV number does. Renaming it renames it everywhere. */
  iv: IvConfig;
  breedingRules: BreedingRule[];
  balance: BalanceConfig;
  /** Anything you add later without touching the schema. */
  custom: Record<string, unknown>;
}

// --- Individuals (the player's actual dragons) -----------------------------

export type DragonSource = "starter" | "bred" | "market" | "admin" | "gift";

export interface Dragon {
  id: string;
  speciesId: SpeciesId;
  nickname: string | null;

  tier: number;
  level: number;
  xp: number;

  bornAt: number;
  source: DragonSource;
  parentIds: [string, string] | null;
  generation: number;

  /** 0-31, rolled fresh at birth and never inherited or changed. */
  iv: number;

  /** Locked dragons can never be consumed by a merge or sold. */
  locked: boolean;
  favorite: boolean;
  /** How many duplicates have been fed into this one. */
  mergeCount: number;

  lastCollectedAt: number;
  uncollectedCoins: number;

  notes: string;
  /** Open bag — add fields here without a save migration. */
  custom: Record<string, unknown>;
}

export interface Bakery {
  id: string;
  level: number;
  storedFood: number;
  lastCollectedAt: number;
}

export interface BreedingSlot {
  parentA: string;
  parentB: string;
  startedAt: number;
  readyAt: number;
  resultSpeciesId: SpeciesId;
}

export interface SaveGame {
  schemaVersion: number;
  playerName: string;
  createdAt: number;
  lastPlayedAt: number;

  coins: number;
  food: number;

  dragons: Dragon[];
  bakeries: Bakery[];
  breeding: BreedingSlot | null;

  roostCapacity: number;
  /** Every species ever owned — drives the Codex and rule conditions. */
  discovered: SpeciesId[];

  custom: Record<string, unknown>;
}
