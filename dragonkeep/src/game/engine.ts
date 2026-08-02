import { buildPool, rollPool } from "./breeding";
import { SCHEMA_VERSION } from "./content";
import {
  bakeryTier,
  coinCap,
  eligibleFodder,
  grantXp,
  incubationSeconds,
  mergeCost,
  nextBakeryUpgrade,
  nextRoostSlotCost,
  pendingCoins,
  pendingFood,
} from "./economy";
import { IV_MAX } from "./types";
import type {
  ContentPack,
  Dragon,
  DragonSource,
  SaveGame,
  SpeciesId,
} from "./types";

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

/** One fresh roll, 0-31 inclusive. Nothing is inherited from the parents. */
export function rollIv(rng: () => number = Math.random): number {
  return Math.floor(rng() * (IV_MAX + 1));
}

let idCounter = 0;
export function newId(prefix = "d"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function createDragon(
  pack: ContentPack,
  speciesId: SpeciesId,
  opts: {
    source: DragonSource;
    parentIds?: [string, string] | null;
    generation?: number;
    now?: number;
    rng?: () => number;
  },
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
    source: opts.source,
    parentIds: opts.parentIds ?? null,
    generation: opts.generation ?? 1,
    iv: rollIv(rng),
    locked: false,
    favorite: false,
    mergeCount: 0,
    lastCollectedAt: now,
    uncollectedCoins: 0,
    notes: "",
    custom: {},
  };
}

export function newGame(pack: ContentPack, now = Date.now()): SaveGame {
  const dragons = pack.balance.startingSpecies
    .filter((id) => pack.species[id])
    .map((id) => createDragon(pack, id, { source: "starter", now }));
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
    bakeries: save.bakeries.map((b) => ({
      ...b,
      storedFood: pendingFood(pack, b, now),
      lastCollectedAt: now,
    })),
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

export function collectBakeries(
  pack: ContentPack,
  save: SaveGame,
  now = Date.now(),
): ActionResult {
  let gained = 0;
  const bakeries = save.bakeries.map((b) => {
    gained += pendingFood(pack, b, now);
    return { ...b, storedFood: 0, lastCollectedAt: now };
  });
  if (gained <= 0) return fail(save, "The ovens are still cold.");
  return {
    save: { ...save, food: save.food + gained, bakeries },
    ok: true,
    message: `Collected ${gained.toLocaleString()} food.`,
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
  if (save.food < cost)
    return fail(save, `Not enough food — you need ${cost}, you have ${save.food}.`);

  const { dragon: fed, levelsGained } = grantXp(pack, dragon, foodType.xp * portions);
  return {
    save: {
      ...save,
      food: save.food - cost,
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
  if (save.dragons.length >= save.roostCapacity)
    return fail(save, "The roost is full — no room for a hatchling.");

  const pool = buildPool(pack, a, b, save.discovered);
  const resultSpeciesId = rollPool(pool, rng());
  if (!resultSpeciesId) return fail(save, "That pairing produced nothing.");

  // Incubation is set by whatever is inside the egg, so a rare result betrays
  // itself through a longer wait.
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
  if (now < nest.readyAt) return fail(save, "The egg has not hatched yet.");
  if (save.dragons.length >= save.roostCapacity)
    return fail(save, "The roost is full — free a slot before hatching.");

  const a = save.dragons.find((d) => d.id === nest.parentA);
  const b = save.dragons.find((d) => d.id === nest.parentB);
  const generation = Math.max(a?.generation ?? 1, b?.generation ?? 1) + 1;

  const hatchling = createDragon(pack, nest.resultSpeciesId, {
    source: "bred",
    parentIds: [nest.parentA, nest.parentB],
    generation,
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
    .sort((x, y) => x.level - y.level || x.iv - y.iv)
    .slice(0, cost);
  const consumedIds = new Set(consumed.map((d) => d.id));

  const upgraded: Dragon = {
    ...target,
    tier: target.tier + 1,
    mergeCount: target.mergeCount + cost,
  };

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

// --- Market and buildings --------------------------------------------------

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
  if (save.coins < species.marketPrice)
    return fail(save, `Costs ${species.marketPrice.toLocaleString()} coins.`);
  if (save.dragons.length >= save.roostCapacity)
    return fail(save, "The roost is full.");

  const dragon = createDragon(pack, speciesId, { source: "market", now, rng });
  const isNew = !save.discovered.includes(speciesId);
  return {
    save: {
      ...save,
      coins: save.coins - species.marketPrice,
      dragons: [...save.dragons, dragon],
      discovered: isNew ? [...save.discovered, speciesId] : save.discovered,
    },
    ok: true,
    message: `${species.name} joined the roost.`,
  };
}

export function buildBakery(
  pack: ContentPack,
  save: SaveGame,
  now = Date.now(),
): ActionResult {
  if (save.bakeries.length >= pack.balance.maxBakeries)
    return fail(save, "You have all the bakeries you can run.");
  const base = bakeryTier(pack, 1);
  const cost = Math.round(
    base.cost * Math.pow(pack.balance.bakeryCostGrowth, save.bakeries.length),
  );
  if (save.coins < cost)
    return fail(save, `A bakery costs ${cost.toLocaleString()} coins.`);
  return {
    save: {
      ...save,
      coins: save.coins - cost,
      bakeries: [
        ...save.bakeries,
        { id: newId("b"), level: 1, storedFood: 0, lastCollectedAt: now },
      ],
    },
    ok: true,
    message: "Bakery built.",
  };
}

export function upgradeBakery(
  pack: ContentPack,
  save: SaveGame,
  bakeryId: string,
): ActionResult {
  const bakery = save.bakeries.find((b) => b.id === bakeryId);
  if (!bakery) return fail(save, "No such bakery.");
  const next = nextBakeryUpgrade(pack, bakery);
  if (!next) return fail(save, "That bakery is fully upgraded.");
  if (save.coins < next.cost)
    return fail(save, `Upgrade costs ${next.cost.toLocaleString()} coins.`);
  return {
    save: {
      ...save,
      coins: save.coins - next.cost,
      bakeries: save.bakeries.map((b) =>
        b.id === bakeryId ? { ...b, level: next.level } : b,
      ),
    },
    ok: true,
    message: `Bakery upgraded to level ${next.level}.`,
  };
}

export function buyRoostSlot(pack: ContentPack, save: SaveGame): ActionResult {
  const cost = nextRoostSlotCost(pack, save.roostCapacity);
  if (save.coins < cost)
    return fail(save, `A new perch costs ${cost.toLocaleString()} coins.`);
  return {
    save: { ...save, coins: save.coins - cost, roostCapacity: save.roostCapacity + 1 },
    ok: true,
    message: `Roost expanded to ${save.roostCapacity + 1} perches.`,
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
  const dragon = createDragon(pack, speciesId, { source: "admin", now });
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
