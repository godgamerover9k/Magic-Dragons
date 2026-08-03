// ---------------------------------------------------------------------------
// Dragonkeep — core data model
//
// Two things live side by side:
//   ContentPack — the game's DESIGN (taxonomy, dragons, rules, balance)
//   SaveGame    — one PLAYER's progress (their dragons, coins, buildings)
//
// A ContentPack is fully editable in Admin mode and can be downloaded as JSON.
// ---------------------------------------------------------------------------

export type TaxonId = string;
export type SpeciesId = string;

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
  /**
   * Bends the payout curve. At 1 the bonus is a straight line. Above 1 the low
   * end is worth almost nothing and the top few points carry most of the value,
   * so 0 and 4 feel alike while 30 and 31 do not.
   */
  curveExponent: number;
  /**
   * Roll twice and keep the worse result, in the D&D sense. Makes high rolls
   * rare without narrowing the range.
   */
  disadvantage: boolean;
  /** Bonus to coins per hour at a perfect 31. 0.25 means +25% at 31, +0% at 0. */
  productionMagnitude: number;
  /** Bonus to xp from food at a perfect 31. */
  growthMagnitude: number;
}

// --- Species (the template) ------------------------------------------------

export interface Species {
  id: SpeciesId;
  name: string;
  taxonId: TaxonId;
  /** Accent colour in the interface. Falls back to a neutral tone. */
  color?: string;
  /** Free-form labels for breeding rules and filtering, e.g. "nocturnal". */
  tags: string[];
  /** Coins per hour at tier 1, level 1, before any multipliers. */
  baseProduction: number;
  /**
   * Seconds an egg of this species takes to hatch. Falls back to
   * balance.defaultIncubationSeconds when not set.
   */
  incubationSeconds?: number;
  /**
   * How much this dragon can bank before it stops earning, in hours of its own
   * output. Falls back to balance.coinStorageHours. Scales as the dragon grows.
   */
  coinStorageHours?: number;
  /**
   * A flat ceiling in coins. When set it overrides the hours above and does NOT
   * scale, so a high-level dragon fills it faster and faster.
   */
  coinCapacity?: number;
  /** Multiplies the xp needed per level. Falls back to 1. */
  xpMultiplier?: number;
  /** Duplicates per tier step. Falls back to balance.mergeCosts. */
  mergeCosts?: number[];
  /** Highest tier this dragon can reach. Falls back to balance.maxTier. */
  maxTier?: number;
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
  /**
   * Both parents must be different dragons. Lets a rule mean "any two distinct
   * members of this branch" rather than firing on a pair of the same kind.
   */
  differentSpecies?: boolean;
  /** Both parents must have at least this individual value. */
  minIv?: number;
  /** Both parents must have at most this individual value. */
  maxIv?: number;
  /** At least one parent must have this individual value or higher. */
  minIvEither?: number;
  /** At least one parent must have this individual value or lower. */
  maxIvEither?: number;
  /**
   * Both parents must sit in different sub-branches of this taxon. Two dragons
   * filed in the same element are turned away, however deeply either is nested.
   */
  differentBranchUnder?: TaxonId;
}

export interface BreedingRule {
  id: string;
  label: string;
  /** Matched in either order: (a,b) or (b,a). */
  a: Matcher;
  b: Matcher;
  outcomes: Outcome[];
  conditions?: RuleConditions;
  enabled: boolean;
  notes?: string;
}

// --- Balance ---------------------------------------------------------------

/**
 * Level and tier are folded into one number, power:
 *
 *     power = level × tierWeight ^ (tier − 1)
 *
 * A level 1 tier 1 dragon has power 1. Nothing downstream reads level or tier
 * directly, so there is one dial for progression rather than two.
 */
export interface PowerFormula {
  /** How many levels one tier step is worth. */
  tierWeight: number;
}

/**
 * Output = base × IV × power ^ exponent.
 * An exponent below 1 gives diminishing returns, so grinding levels onto a weak
 * dragon cannot catch a rare one.
 */
export interface ProductionFormula {
  exponent: number;
}

/**
 * Capacity reads the same power, with its own exponent. Keeping this above the
 * production exponent means a raised dragon holds more hours of output than it
 * used to, so the wait between collections lengthens as it grows.
 */
export interface CapacityFormula {
  exponent: number;
}

/**
 * One thing a bakery can be told to make. Bought with coins, takes real time,
 * yields food. The cheapest option is free so a player is never stuck.
 */
export interface FoodBatch {
  id: string;
  name: string;
  coinCost: number;
  seconds: number;
  food: number;
}

export interface BalanceConfig {
  startingCoins: number;
  startingFood: number;
  /** Species handed out on a fresh save. */
  startingSpecies: SpeciesId[];
  roostCapacity: number;
  roostSlotCost: number;
  /**
   * Perches grow polynomially: cost = roostSlotCost × n ^ exponent, where n is
   * the perch being bought. Each one costs more than the last, but the ratio
   * between them shrinks, so the roost stays affordable late.
   */
  roostSlotCostExponent: number;

  power: PowerFormula;
  production: ProductionFormula;
  capacity: CapacityFormula;
  /** Base storage, in hours of output, for a level 1 tier 1 dragon. */
  coinStorageHours: number;

  /** Default duplicates per tier step, when a dragon does not set its own. */
  mergeCosts: number[];
  /** Default ceiling on tiers. */
  maxTier: number;

  levelXpBase: number;
  levelXpExponent: number;
  maxLevel: number;

  /** Weight each parent contributes to every breeding pool. */
  parentWeight: number;
  /** Fallback incubation for species that do not set their own. */
  defaultIncubationSeconds: number;

  maxBakeries: number;
  /** Coin cost of the very first oven, kept low so a new keeper can reach it. */
  firstBakeryCost: number;
  /** Coin cost the ladder resumes at, for the second oven onwards. */
  bakeryCost: number;
  /** Each additional bakery costs this much more than the last. */
  bakeryCostGrowth: number;
  /** Experience a single unit of food is worth. */
  xpPerFood: number;
  foodBatches: FoodBatch[];
}

// --- Content pack ----------------------------------------------------------

export interface ContentPack {
  /** Bumped when the shape changes, so old saves can be migrated. */
  schemaVersion: number;
  /**
   * Your content version. Raise it whenever you ship changes: a player holding
   * an older pack is moved onto the new one automatically. Leave it alone and
   * their own Admin edits survive.
   */
  version: number;
  name: string;
  taxa: Record<TaxonId, Taxon>;
  species: Record<SpeciesId, Species>;
  /** What the one IV number does. Renaming it renames it everywhere. */
  iv: IvConfig;
  breedingRules: BreedingRule[];
  balance: BalanceConfig;
  /** Anything you add later without touching the schema. */
  custom: Record<string, unknown>;
}

// --- Individuals (the player's actual dragons) -----------------------------

export interface Dragon {
  id: string;
  speciesId: SpeciesId;
  nickname: string | null;

  tier: number;
  level: number;
  xp: number;

  bornAt: number;
  parentIds: [string, string] | null;

  /** 0-31, rolled fresh at birth and never inherited or changed. */
  iv: number;

  /**
   * Out of the roost and into storage. Stored dragons earn nothing — perches are
   * the only thing that makes money — but storage is unlimited, so no dragon
   * ever has to be turned away or released for want of room.
   */
  stored?: boolean;
  /** Locked dragons can never be consumed by a merge or sold. */
  locked: boolean;
  favorite: boolean;

  lastCollectedAt: number;
  uncollectedCoins: number;

  notes: string;
  /** Open bag — add fields here without a save migration. */
  custom: Record<string, unknown>;
}

export interface Bakery {
  id: string;
  /** The batch currently baking, or null when the oven is idle. */
  batchId: string | null;
  startedAt: number;
  readyAt: number;
}

export interface BreedingSlot {
  parentA: string;
  parentB: string;
  /** Recorded at nesting, so the log survives a parent being released. */
  parentSpecies?: [SpeciesId, SpeciesId];
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

  /** How many dragons can be perched at once. Storage beyond this is free. */
  roostCapacity: number;
  /**
   * Testing mode. Resources are treated as unlimited, the roost never fills,
   * timers can be skipped, and breeding odds are shown.
   */
  adminMode: boolean;
  /** Every species ever owned — drives the Codex and rule conditions. */
  discovered: SpeciesId[];
  /**
   * What each pairing has produced, keyed by the two parent species sorted and
   * joined. Only ever written from hatches the player actually saw.
   */
  breedingLog?: Record<string, Record<SpeciesId, number>>;

  custom: Record<string, unknown>;
}
