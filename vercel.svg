import { buildPool, rollPool } from "./breeding";
import { SCHEMA_VERSION } from "./content";
import {
  batchById,
  coinCap,
  eligibleFodder,
  grantXp,
  incubationSeconds,
  mergeCost,
  nextBakeryCost,
  nextRoostSlotCost,
  ovenState,
  pendingCoins,
} from "./economy";
import { IV_MAX } from "./types";
import type { ContentPack, Dragon, SaveGame, SpeciesId } from "./types";

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

export function roostIsFull(save: SaveGame): boolean {
  if (save.adminMode) return false;
  return save.dragons.length >= save.roostCapacity;
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
    breeding: null,
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
    dragons: save.dragons.map((d) => ({
      ...d,
      uncollectedCoins: pendingCoins(pack, d, now),
      lastCollectedAt: now,
    })),
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

export function feed(
  pack: ContentPack,
  save: SaveGame,
  dragonId: string,
  foodTypeId: string,
  portions = 1,
): ActionResult {
  const dragon = save.dragons.find((d) => d.id === dragonId);
  if (!dragon) return fail(save, "That dragon is not in your roost.");
  const foodType = pack.balance.foodTypes.find((f) => f.id === foodTypeId);
  if (!foodType) return fail(save, "Unknown food.");
  if (dragon.level >= pack.balance.maxLevel)
    return fail(save, `${nameOf(pack, dragon)} is already at max level.`);

  const cost = foodType.foodCost * portions;
  if (!canAfford(save, 0, cost))
    return fail(save, `Not enough food — you need ${cost}, you have ${save.food}.`);

  const { dragon: fed, levelsGained } = grantXp(pack, dragon, foodType.xp * portions);
  return {
    save: {
      ...spend(save, 0, cost),
      dragons: save.dragons.map((d) => (d.id === dragonId ? fed : d)),
    },
    ok: true,
    message: levelsGained
      ? `${nameOf(pack, fed)} reached level ${fed.level}.`
      : `Fed ${nameOf(pack, fed)}.`,
  };
}

// --- Breeding --------------------------------------------------------------

export function startBreeding(
  pack: ContentPack,
  save: SaveGame,
  aId: string,
  bId: string,
  now = Date.now(),
  rng: () => number = Math.random,
): ActionResult {
  if (save.breeding) return fail(save, "A pairing is already under way.");
  if (aId === bId) return fail(save, "Pick two different dragons.");
  const a = save.dragons.find((d) => d.id === aId);
  const b = save.dragons.find((d) => d.id === bId);
  if (!a || !b) return fail(save, "Both parents must be in your roost.");
  if (roostIsFull(save))
    return fail(save, "The roost is full — no room for a hatchling.");

  const pool = buildPool(pack, a, b, save.discovered);
  const resultSpeciesId = rollPool(pool, rng());
  if (!resultSpeciesId) return fail(save, "That pairing produced nothing.");

  const seconds = incubationSeconds(pack, resultSpeciesId);

  return {
    save: {
      ...save,
      breeding: {
        parentA: aId,
        parentB: bId,
        startedAt: now,
        readyAt: now + seconds * 1000,
        resultSpeciesId,
      },
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
): ActionResult {
  const nest = save.breeding;
  if (!nest) return fail(save, "There is no egg.");
  if (now < nest.readyAt && !save.adminMode)
    return fail(save, "The egg has not hatched yet.");
  if (roostIsFull(save))
    return fail(save, "The roost is full — free a slot before hatching.");

  const hatchling = createDragon(pack, nest.resultSpeciesId, {
    parentIds: [nest.parentA, nest.parentB],
    now,
    rng,
  });

  const isNew = !save.discovered.includes(hatchling.speciesId);
  return {
    save: {
      ...save,
      breeding: null,
      dragons: [...save.dragons, hatchling],
      discovered: isNew ? [...save.discovered, hatchling.speciesId] : save.discovered,
    },
    ok: true,
    message: isNew
      ? `New to the codex — ${nameOf(pack, hatchling)}.`
      : `Hatched ${nameOf(pack, hatchling)}.`,
  };
}

export function cancelBreeding(save: SaveGame): ActionResult {
  if (!save.breeding) return fail(save, "There is no pairing to cancel.");
  return { save: { ...save, breeding: null }, ok: true, message: "Pairing cancelled." };
}

/** Admin only — drops the remaining wait on an egg. */
export function skipIncubation(save: SaveGame, now = Date.now()): ActionResult {
  if (!save.adminMode) return fail(save, "Only available in admin mode.");
  if (!save.breeding) return fail(save, "There is no egg.");
  return {
    save: { ...save, breeding: { ...save.breeding, readyAt: now } },
    ok: true,
    message: "Egg ready.",
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
  if (roostIsFull(save)) return fail(save, "The roost is full.");

  const dragon = createDragon(pack, speciesId, { now, rng });
  const isNew = !save.discovered.includes(speciesId);
  return {
    save: {
      ...spend(save, species.marketPrice),
      dragons: [...save.dragons, dragon],
      discovered: isNew ? [...save.discovered, speciesId] : save.discovered,
    },
    ok: true,
    message: `${species.name} joined the roost.`,
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
  const dragon = createDragon(pack, speciesId, { now });
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

export function nameOf(pack: ContentPack, dragon: Dragon): string {
  return dragon.nickname || pack.species[dragon.speciesId]?.name || "Unknown";
}
