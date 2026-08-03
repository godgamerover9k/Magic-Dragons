import { buildPool, rollPool } from "./breeding";
import { SCHEMA_VERSION } from "./schema";
import {
  batchById,
  coinCap,
  eligibleFodder,
  foodToNextLevel,
  grantXp,
  formatDuration,
  incubationSeconds,
  marketCooldownLeft,
  mergeCost,
  nextBakeryCost,
  nextRoostSlotCost,
  ovenState,
  pendingCoins,
} from "./economy";
import { IV_MAX } from "./types";
import type { BreedingSlot, ContentPack, Dragon, SaveGame, SpeciesId } from "./types";

export interface ActionResult {
  save: SaveGame;
  ok: boolean;
  message: string;
}

const fail = (save: SaveGame, message: string): ActionResult => ({
  save,
  ok: false,
  message,
});

// --- Admin mode ------------------------------------------------------------
// In admin mode nothing is deducted, nothing is capped and nothing has to wait.
// Every cost and limit in this file routes through these three helpers, so the
// mode cannot drift out of sync with the rules.

export function canAfford(save: SaveGame, coins = 0, food = 0): boolean {
  if (save.adminMode) return true;
  return save.coins >= coins && save.food >= food;
}

function spend(save: SaveGame, coins = 0, food = 0): SaveGame {
  if (save.adminMode) return save;
  return { ...save, coins: save.coins - coins, food: save.food - food };
}

/** Dragons currently earning, i.e. not in storage. */
export function perchedCount(save: SaveGame): number {
  return save.dragons.filter((d) => !d.stored).length;
}

/**
 * True when every perch is taken. This no longer blocks anything — a new dragon
 * simply arrives in storage — but it decides where one lands.
 */
export function perchesFull(save: SaveGame): boolean {
  if (save.adminMode) return false;
  return perchedCount(save) >= save.roostCapacity;
}

let idCounter = 0;
export function newId(prefix = "d"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/**
 * A fresh roll, 0-31 inclusive, nothing inherited. Rolled with disadvantage in
 * the D&D sense — two rolls, keep the worse — so high values stay rare.
 */
export function rollIv(pack: ContentPack, rng: () => number = Math.random): number {
  const one = Math.floor(rng() * (IV_MAX + 1));
  if (!pack.iv.disadvantage) return one;
  const two = Math.floor(rng() * (IV_MAX + 1));
  return Math.min(one, two);
}

export function createDragon(
  pack: ContentPack,
  speciesId: SpeciesId,
  opts: {
    parentIds?: [string, string] | null;
    now?: number;
    rng?: () => number;
  } = {},
): Dragon {
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? Date.now();
  return {
    id: newId(),
    speciesId,
    nickname: null,
    tier: 1,
    level: 1,
    xp: 0,
    bornAt: now,
    parentIds: opts.parentIds ?? null,
    iv: rollIv(pack, rng),
    locked: false,
    favorite: false,
    lastCollectedAt: now,
    uncollectedCoins: 0,
    notes: "",
    custom: {},
  };
}

/**
 * The one state a player cannot recover from: no dragons, and not enough coins
 * to buy the cheapest one. Coins come from dragons, so nothing would ever
 * change. Rather than let that happen, the purse is topped up to the price of
 * the cheapest dragon on sale.
 */
/** Eggs currently sitting, tolerating saves written before nests existed. */
export function nestsOf(save: SaveGame): BreedingSlot[] {
  if (save.nests) return save.nests;
  return save.breeding ? [{ ...save.breeding, id: save.breeding.id ?? "nest_1" }] : [];
}

export function ensureViable(pack: ContentPack, save: SaveGame): SaveGame {
  if (save.dragons.length > 0 || nestsOf(save).length > 0) return save;

  const prices = Object.values(pack.species)
    .filter((s) => s.obtainable && s.marketPrice && s.marketPrice > 0)
    .map((s) => s.marketPrice as number);
  if (prices.length === 0) return save;

  const cheapest = Math.min(...prices);
  if (save.coins >= cheapest) return save;
  return { ...save, coins: cheapest };
}

export function newGame(pack: ContentPack, now = Date.now()): SaveGame {
  const dragons = pack.balance.startingSpecies
    .filter((id) => pack.species[id])
    .map((id) => createDragon(pack, id, { now }));
  return {
    schemaVersion: SCHEMA_VERSION,
    playerName: "Keeper",
    createdAt: now,
    lastPlayedAt: now,
    coins: pack.balance.startingCoins,
    food: pack.balance.startingFood,
    dragons,
    bakeries: [],
    nests: [],
    nestCapacity: pack.balance.nestCapacity ?? 1,
    roostCapacity: pack.balance.roostCapacity,
    adminMode: false,
    discovered: [...new Set(dragons.map((d) => d.speciesId))],
    custom: {},
  };
}

/** Folds elapsed real time into stored values. Safe to call every tick. */
export function settle(
  pack: ContentPack,
  save: SaveGame,
  now = Date.now(),
): SaveGame {
  return {
    ...save,
    lastPlayedAt: now,
    dragons: save.dragons.map((d) =>
      d.stored
        ? d
        : { ...d, uncollectedCoins: pendingCoins(pack, d, now), lastCollectedAt: now },
    ),
  };
}

export function setAdminMode(save: SaveGame, on: boolean): ActionResult {
  return {
    save: { ...save, adminMode: on },
    ok: true,
    message: on ? "Admin mode on — nothing costs anything." : "Admin mode off.",
  };
}

// --- Collection ------------------------------------------------------------

export function collectAllCoins(
  pack: ContentPack,
  save: SaveGame,
  now = Date.now(),
): ActionResult {
  let gained = 0;
  const dragons = save.dragons.map((d) => {
    gained += pendingCoins(pack, d, now);
    return { ...d, uncollectedCoins: 0, lastCollectedAt: now };
  });
  if (gained <= 0) return fail(save, "Nothing banked yet.");
  return {
    save: { ...save, coins: save.coins + gained, dragons },
    ok: true,
    message: `Collected ${gained.toLocaleString()} coins.`,
  };
}

// --- Feeding ---------------------------------------------------------------

/**
 * Food is a single pool. The player decides how much of it goes into which
 * dragon; every unit is worth balance.xpPerFood, adjusted by the dragon's IV.
 */
export function feed(
  pack: ContentPack,
  save: SaveGame,
  dragonId: string,
  amount: number,
): ActionResult {
  const dragon = save.dragons.find((d) => d.id === dragonId);
  if (!dragon) return fail(save, "That dragon is not in your roost.");
  if (dragon.level >= pack.balance.maxLevel)
    return fail(save, `${nameOf(pack, dragon)} is already at max level.`);

  const portions = Math.floor(amount);
  if (portions <= 0) return fail(save, "Feed at least one.");
  if (!canAfford(save, 0, portions))
    return fail(save, `Not enough food — you need ${portions}, you have ${save.food}.`);

  const { dragon: fed, levelsGained } = grantXp(
    pack,
    dragon,
    portions * pack.balance.xpPerFood,
  );
  return {
    save: {
      ...spend(save, 0, portions),
      dragons: save.dragons.map((d) => (d.id === dragonId ? fed : d)),
    },
    ok: true,
    message: levelsGained
      ? `${nameOf(pack, fed)} reached level ${fed.level}.`
      : `Fed ${nameOf(pack, fed)} ${portions} food.`,
  };
}

/**
 * Feeds exactly enough to reach the next level. When there is not enough food
 * for that, it feeds everything available rather than refusing outright.
 */
export function feedToNextLevel(
  pack: ContentPack,
  save: SaveGame,
  dragonId: string,
): ActionResult {
  const dragon = save.dragons.find((d) => d.id === dragonId);
  if (!dragon) return fail(save, "That dragon is not in your roost.");

  const needed = foodToNextLevel(pack, dragon);
  if (needed === null)
    return fail(save, `${nameOf(pack, dragon)} is already at max level.`);

  const available = save.adminMode ? needed : save.food;
  if (available <= 0) return fail(save, "You have no food.");

  const portions = Math.min(needed, available);
  const result = feed(pack, save, dragonId, portions);
  if (!result.ok || portions >= needed) return result;

  return {
    ...result,
    message: `Fed all ${portions} food — ${needed - portions} short of the next level.`,
  };
}

// --- Breeding --------------------------------------------------------------

export function nestCapacityOf(pack: ContentPack, save: SaveGame): number {
  return save.nestCapacity ?? pack.balance.nestCapacity ?? 1;
}

/** Coin cost of the next nest, given how many are already owned. */
export function nextNestCost(pack: ContentPack, owned: number): number {
  const base = pack.balance.nestCost ?? 0;
  const growth = pack.balance.nestCostGrowth ?? 1;
  const extra = Math.max(0, owned - (pack.balance.nestCapacity ?? 1));
  return Math.round(base * Math.pow(growth, extra));
}

export function buyNest(pack: ContentPack, save: SaveGame): ActionResult {
  const owned = nestCapacityOf(pack, save);
  if (owned >= (pack.balance.maxNests ?? 1) && !save.adminMode)
    return fail(save, "You have all the nests you can keep.");
  const cost = nextNestCost(pack, owned);
  if (!canAfford(save, cost))
    return fail(save, `A nest costs ${cost.toLocaleString()} coins.`);
  return {
    save: { ...spend(save, cost), nestCapacity: owned + 1 },
    ok: true,
    message: `You keep ${owned + 1} nests now.`,
  };
}

export function startBreeding(
  pack: ContentPack,
  save: SaveGame,
  aId: string,
  bId: string,
  now = Date.now(),
  rng: () => number = Math.random,
): ActionResult {
  const nests = nestsOf(save);
  if (nests.length >= nestCapacityOf(pack, save))
    return fail(save, "Every nest is occupied.");
  if (aId === bId) return fail(save, "Pick two different dragons.");
  if (nests.some((n) => [n.parentA, n.parentB].includes(aId) || [n.parentA, n.parentB].includes(bId)))
    return fail(save, "One of those is already sitting on an egg.");
  const a = save.dragons.find((d) => d.id === aId);
  const b = save.dragons.find((d) => d.id === bId);
  if (!a || !b) return fail(save, "Both parents must be in your roost.");

  const pool = buildPool(pack, a, b);
  const resultSpeciesId = rollPool(pool, rng());
  if (!resultSpeciesId) return fail(save, "That pairing produced nothing.");

  const seconds = incubationSeconds(pack, resultSpeciesId);

  return {
    save: {
      ...save,
      breeding: null,
      nests: [
        ...nests,
        {
          id: newId("n"),
          parentA: aId,
          parentB: bId,
          parentSpecies: [a.speciesId, b.speciesId],
          startedAt: now,
          readyAt: now + seconds * 1000,
          resultSpeciesId,
        },
      ],
    },
    ok: true,
    message: seconds > 0 ? "The pair has nested." : "An egg is ready.",
  };
}

export function claimHatchling(
  pack: ContentPack,
  save: SaveGame,
  now = Date.now(),
  rng: () => number = Math.random,
  nestId?: string,
): ActionResult {
  const nests = nestsOf(save);
  const nest = nestId ? nests.find((n) => n.id === nestId) : nests[0];
  if (!nest) return fail(save, "There is no egg.");
  if (now < nest.readyAt && !save.adminMode)
    return fail(save, "The egg has not hatched yet.");

  const stored = perchesFull(save);
  const hatchling = {
    ...createDragon(pack, nest.resultSpeciesId, {
      parentIds: [nest.parentA, nest.parentB],
      now,
      rng,
    }),
    stored,
  };

  const isNew = !save.discovered.includes(hatchling.speciesId);

  // Record what this pairing produced. Players compare notes; this is the note.
  const fallback = [nest.parentA, nest.parentB]
    .map((id) => save.dragons.find((d) => d.id === id)?.speciesId)
    .filter(Boolean) as SpeciesId[];
  const parents = nest.parentSpecies ?? fallback;
  const log = { ...(save.breedingLog ?? {}) };
  if (parents.length === 2) {
    const key = pairKey(parents[0], parents[1]);
    const row = { ...(log[key] ?? {}) };
    row[hatchling.speciesId] = (row[hatchling.speciesId] ?? 0) + 1;
    log[key] = row;
  }

  return {
    save: {
      ...save,
      breeding: null,
      nests: nests.filter((n) => n.id !== nest.id),
      breedingLog: log,
      dragons: [...save.dragons, hatchling],
      discovered: isNew ? [...save.discovered, hatchling.speciesId] : save.discovered,
    },
    ok: true,
    message: stored
      ? `Hatched ${nameOf(pack, hatchling)} — no free perch, so it went to storage.`
      : isNew
        ? `New to the codex — ${nameOf(pack, hatchling)}.`
        : `Hatched ${nameOf(pack, hatchling)}.`,
  };
}

/** Admin only — drops the remaining wait on an egg. */
export function skipIncubation(save: SaveGame, now = Date.now()): ActionResult {
  if (!save.adminMode) return fail(save, "Only available in admin mode.");
  const nests = nestsOf(save);
  if (nests.length === 0) return fail(save, "There is no egg.");
  return {
    save: { ...save, breeding: null, nests: nests.map((n) => ({ ...n, readyAt: now })) },
    ok: true,
    message: "Eggs ready.",
  };
}

// --- Merging ---------------------------------------------------------------

export function merge(
  pack: ContentPack,
  save: SaveGame,
  targetId: string,
): ActionResult {
  const target = save.dragons.find((d) => d.id === targetId);
  if (!target) return fail(save, "That dragon is not in your roost.");
  const cost = mergeCost(pack, target);
  if (cost === null) return fail(save, `${nameOf(pack, target)} is at max tier.`);

  const fodder = eligibleFodder(save.dragons, target);
  if (fodder.length < cost)
    return fail(
      save,
      `Needs ${cost} unlocked duplicates at tier ${target.tier} — you have ${fodder.length}.`,
    );

  // Consume the least developed duplicates first.
  const consumed = [...fodder]
    .sort((x, y) => x.level - y.level || (x.iv ?? 0) - (y.iv ?? 0))
    .slice(0, cost);
  const consumedIds = new Set(consumed.map((d) => d.id));

  const upgraded: Dragon = { ...target, tier: target.tier + 1 };

  return {
    save: {
      ...save,
      dragons: save.dragons
        .filter((d) => !consumedIds.has(d.id))
        .map((d) => (d.id === targetId ? upgraded : d)),
    },
    ok: true,
    message: `${nameOf(pack, upgraded)} is now tier ${upgraded.tier}.`,
  };
}

// --- Market and roost ------------------------------------------------------

export function buySpecies(
  pack: ContentPack,
  save: SaveGame,
  speciesId: SpeciesId,
  now = Date.now(),
  rng: () => number = Math.random,
): ActionResult {
  const species = pack.species[speciesId];
  if (!species || !species.marketPrice)
    return fail(save, "That dragon is not for sale.");
  if (!canAfford(save, species.marketPrice))
    return fail(save, `Costs ${species.marketPrice.toLocaleString()} coins.`);

  // One of each kind a day. Coins should not be able to buy a collection.
  if (!save.adminMode) {
    const wait = marketCooldownLeft(pack, save, speciesId, now);
    if (wait > 0)
      return fail(
        save,
        `${species.name} has already been bought today — ${formatDuration(wait)} to go.`,
      );
  }

  const dragon = { ...createDragon(pack, speciesId, { now, rng }), stored: perchesFull(save) };
  const isNew = !save.discovered.includes(speciesId);
  return {
    save: {
      ...spend(save, species.marketPrice),
      dragons: [...save.dragons, dragon],
      discovered: isNew ? [...save.discovered, speciesId] : save.discovered,
      marketPurchases: { ...(save.marketPurchases ?? {}), [speciesId]: now },
    },
    ok: true,
    message: dragon.stored
      ? `${species.name} bought — no free perch, so it went to storage.`
      : `${species.name} joined the roost.`,
  };
}

export function buyRoostSlot(pack: ContentPack, save: SaveGame): ActionResult {
  const cost = nextRoostSlotCost(pack, save.roostCapacity);
  if (!canAfford(save, cost))
    return fail(save, `A new perch costs ${cost.toLocaleString()} coins.`);
  return {
    save: { ...spend(save, cost), roostCapacity: save.roostCapacity + 1 },
    ok: true,
    message: `Roost expanded to ${save.roostCapacity + 1} perches.`,
  };
}

// --- Bakeries --------------------------------------------------------------
// An oven does nothing on its own. You choose a batch, pay for it, and it bakes
// for a set time. More expensive batches take longer and yield more.

export function buildBakery(
  pack: ContentPack,
  save: SaveGame,
  now = Date.now(),
): ActionResult {
  if (save.bakeries.length >= pack.balance.maxBakeries && !save.adminMode)
    return fail(save, "You have all the bakeries you can run.");
  const cost = nextBakeryCost(pack, save.bakeries.length);
  if (!canAfford(save, cost))
    return fail(save, `A bakery costs ${cost.toLocaleString()} coins.`);
  return {
    save: {
      ...spend(save, cost),
      bakeries: [
        ...save.bakeries,
        { id: newId("b"), batchId: null, startedAt: now, readyAt: now },
      ],
    },
    ok: true,
    message: "Bakery built.",
  };
}

export function startBatch(
  pack: ContentPack,
  save: SaveGame,
  bakeryId: string,
  batchId: string,
  now = Date.now(),
): ActionResult {
  const oven = save.bakeries.find((b) => b.id === bakeryId);
  if (!oven) return fail(save, "No such bakery.");
  if (ovenState(oven, now) !== "idle")
    return fail(save, "That oven is already busy.");
  const batch = batchById(pack, batchId);
  if (!batch) return fail(save, "Unknown recipe.");
  if (!canAfford(save, batch.coinCost))
    return fail(save, `${batch.name} costs ${batch.coinCost.toLocaleString()} coins.`);

  return {
    save: {
      ...spend(save, batch.coinCost),
      bakeries: save.bakeries.map((b) =>
        b.id === bakeryId
          ? { ...b, batchId, startedAt: now, readyAt: now + batch.seconds * 1000 }
          : b,
      ),
    },
    ok: true,
    message: `${batch.name} is in the oven.`,
  };
}

export function collectBatch(
  pack: ContentPack,
  save: SaveGame,
  bakeryId: string,
  now = Date.now(),
): ActionResult {
  const oven = save.bakeries.find((b) => b.id === bakeryId);
  if (!oven) return fail(save, "No such bakery.");
  if (ovenState(oven, now) !== "ready") return fail(save, "It is not out of the oven yet.");
  const batch = batchById(pack, oven.batchId);
  if (!batch) return fail(save, "That recipe no longer exists.");

  return {
    save: {
      ...save,
      food: save.food + batch.food,
      bakeries: save.bakeries.map((b) =>
        b.id === bakeryId ? { ...b, batchId: null, startedAt: now, readyAt: now } : b,
      ),
    },
    ok: true,
    message: `Collected ${batch.food.toLocaleString()} food.`,
  };
}

export function collectAllBatches(
  pack: ContentPack,
  save: SaveGame,
  now = Date.now(),
): ActionResult {
  let gained = 0;
  const bakeries = save.bakeries.map((oven) => {
    if (ovenState(oven, now) !== "ready") return oven;
    gained += batchById(pack, oven.batchId)?.food ?? 0;
    return { ...oven, batchId: null, startedAt: now, readyAt: now };
  });
  if (gained <= 0) return fail(save, "Nothing is out of the oven.");
  return {
    save: { ...save, food: save.food + gained, bakeries },
    ok: true,
    message: `Collected ${gained.toLocaleString()} food.`,
  };
}

/** Admin only — finishes a batch immediately. */
export function skipBaking(
  save: SaveGame,
  bakeryId: string,
  now = Date.now(),
): ActionResult {
  if (!save.adminMode) return fail(save, "Only available in admin mode.");
  return {
    save: {
      ...save,
      bakeries: save.bakeries.map((b) => (b.id === bakeryId ? { ...b, readyAt: now } : b)),
    },
    ok: true,
    message: "Out of the oven.",
  };
}

// --- Individual upkeep -----------------------------------------------------

export function updateDragon(
  save: SaveGame,
  dragonId: string,
  patch: Partial<Dragon>,
): ActionResult {
  if (!save.dragons.some((d) => d.id === dragonId))
    return fail(save, "No such dragon.");
  return {
    save: {
      ...save,
      dragons: save.dragons.map((d) => (d.id === dragonId ? { ...d, ...patch } : d)),
    },
    ok: true,
    message: "Saved.",
  };
}

export function perchDragon(save: SaveGame, dragonId: string): ActionResult {
  const dragon = save.dragons.find((d) => d.id === dragonId);
  if (!dragon) return fail(save, "No such dragon.");
  if (!dragon.stored) return fail(save, "It is already on a perch.");
  if (perchesFull(save))
    return fail(save, "Every perch is taken — store another dragon or buy a perch.");
  return {
    save: {
      ...save,
      dragons: save.dragons.map((d) =>
        // The clock restarts: it earns from the moment it is put to work.
        d.id === dragonId ? { ...d, stored: false, lastCollectedAt: Date.now() } : d,
      ),
    },
    ok: true,
    message: "Moved to a perch.",
  };
}

export function storeDragon(save: SaveGame, dragonId: string): ActionResult {
  const dragon = save.dragons.find((d) => d.id === dragonId);
  if (!dragon) return fail(save, "No such dragon.");
  if (dragon.stored) return fail(save, "It is already in storage.");
  return {
    save: {
      ...save,
      dragons: save.dragons.map((d) =>
        d.id === dragonId ? { ...d, stored: true } : d,
      ),
    },
    ok: true,
    message: "Moved to storage. It earns nothing there.",
  };
}

export function releaseDragon(
  pack: ContentPack,
  save: SaveGame,
  dragonId: string,
): ActionResult {
  const dragon = save.dragons.find((d) => d.id === dragonId);
  if (!dragon) return fail(save, "No such dragon.");
  if (dragon.locked) return fail(save, "That dragon is locked.");
  if (save.dragons.length <= 1) return fail(save, "You cannot release your last dragon.");
  const refund = Math.round(coinCap(pack, dragon) * 0.5);
  return {
    save: {
      ...save,
      coins: save.coins + refund,
      dragons: save.dragons.filter((d) => d.id !== dragonId),
    },
    ok: true,
    message: `Released ${nameOf(pack, dragon)} for ${refund.toLocaleString()} coins.`,
  };
}

/** Admin only — drops a dragon straight into the roost. */
export function grantDragon(
  pack: ContentPack,
  save: SaveGame,
  speciesId: SpeciesId,
  now = Date.now(),
): ActionResult {
  if (!pack.species[speciesId]) return fail(save, "No such species.");
  const dragon = { ...createDragon(pack, speciesId, { now }), stored: perchesFull(save) };
  const isNew = !save.discovered.includes(speciesId);
  return {
    save: {
      ...save,
      dragons: [...save.dragons, dragon],
      discovered: isNew ? [...save.discovered, speciesId] : save.discovered,
    },
    ok: true,
    message: `Granted ${pack.species[speciesId].name}.`,
  };
}

/** Stable key for a pairing, so A×B and B×A share a line in the log. */
export function pairKey(a: SpeciesId, b: SpeciesId): string {
  return [a, b].sort().join("+");
}

export function nameOf(pack: ContentPack, dragon: Dragon): string {
  return dragon.nickname || pack.species[dragon.speciesId]?.name || "Unknown";
}
