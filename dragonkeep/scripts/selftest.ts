import assert from "node:assert";
import { buildPool, chanceOf, rollPool } from "../src/game/breeding";
import { defaultContentPack } from "../src/game/content";
import {
  coinsPerHour,
  grantXp,
  incubationSeconds,
  ivBonus,
  mergeCost,
  pendingCoins,
  xpToNextLevel,
} from "../src/game/economy";
import {
  claimHatchling,
  createDragon,
  feed,
  merge,
  newGame,
  startBreeding,
} from "../src/game/engine";
import { migrateSave, validatePack } from "../src/game/storage";
import { isWithin, taxonPath } from "../src/game/taxonomy";
import { IV_MAX, IV_MIN, type Dragon } from "../src/game/types";

const pack = defaultContentPack();
const NOW = 1_700_000_000_000;
const LATER = NOW + 100_000_000;
let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed++;
  console.log("  ok  " + label);
};
const make = (speciesId: string, iv = 0) => ({
  ...createDragon(pack, speciesId, { source: "admin", now: NOW, rng: () => 0.5 }),
  iv,
});

console.log("\nContent");
check("placeholder pack validates clean", () => {
  const issues = validatePack(pack).filter((i) => i.level === "error");
  assert.deepStrictEqual(issues, [], JSON.stringify(issues, null, 2));
});

check("every dragon can actually be obtained", () => {
  const warnings = validatePack(pack).filter((i) =>
    i.message.includes("No way to obtain"),
  );
  assert.deepStrictEqual(warnings, []);
});

console.log("\nTaxonomy");
check("arbitrary depth ancestry resolves", () => {
  assert.strictEqual(taxonPath(pack, "branch-a-1"), "Root › Branch A › Sub-branch A1");
  assert.ok(isWithin(pack, "branch-a-1", "root"));
  assert.ok(!isWithin(pack, "branch-a-1", "branch-b"));
});

console.log("\nBreeding pool");
const one = make("placeholder-1");
const two = make("placeholder-2");
const three = make("placeholder-3");

check("parents are always in the pool", () => {
  const pool = buildPool(pack, one, two, []);
  assert.ok(pool.entries.some((e) => e.speciesId === "placeholder-1"));
  assert.ok(pool.entries.some((e) => e.speciesId === "placeholder-2"));
});

check("a named pair rule fires", () => {
  const pool = buildPool(pack, one, two, []);
  assert.ok(pool.appliedRules.some((r) => r.id === "rule-example-species"));
});

check("a branch rule fires for two parents under it", () => {
  const four = make("placeholder-4");
  const pool = buildPool(pack, two, four, []);
  assert.ok(pool.appliedRules.some((r) => r.id === "rule-example-taxon"));
});

check("a tag rule crosses branches", () => {
  const pool = buildPool(pack, one, three, []);
  assert.ok(pool.appliedRules.some((r) => r.id === "rule-example-tag"));
  assert.ok(!pool.appliedRules.some((r) => r.id === "rule-example-taxon"));
});

check("rules match in either order", () => {
  const fwd = buildPool(pack, one, two, []);
  const rev = buildPool(pack, two, one, []);
  assert.strictEqual(fwd.totalWeight, rev.totalWeight);
});

check("weights sum and probabilities total 1", () => {
  const pool = buildPool(pack, one, two, []);
  const sum = pool.entries.reduce((n, e) => n + e.weight, 0);
  assert.strictEqual(sum, pool.totalWeight);
  const p = pool.entries.reduce((n, e) => n + chanceOf(pool, e.speciesId), 0);
  assert.ok(Math.abs(p - 1) < 1e-9);
});

check("tier conditions gate a rule", () => {
  const four = make("placeholder-4");
  assert.strictEqual(chanceOf(buildPool(pack, three, four, []), "placeholder-5"), 0);
  const pool = buildPool(pack, { ...three, tier: 2 }, { ...four, tier: 2 }, []);
  assert.strictEqual(chanceOf(pool, "placeholder-5"), 1);
});

check("exclusive rules replace the entire pool", () => {
  const a = { ...three, tier: 2 };
  const b = { ...make("placeholder-4"), tier: 2 };
  const pool = buildPool(pack, a, b, []);
  assert.strictEqual(pool.entries.length, 1);
  assert.strictEqual(rollPool(pool, 0.999), "placeholder-5");
});

check("exclusive stops firing once discovered", () => {
  const a = { ...three, tier: 2 };
  const b = { ...make("placeholder-4"), tier: 2 };
  assert.strictEqual(buildPool(pack, a, b, ["placeholder-5"]).exclusiveRule, null);
});

check("roll boundaries land in the right bucket", () => {
  const pool = buildPool(pack, one, two, []);
  assert.strictEqual(rollPool(pool, 0), pool.entries[0].speciesId);
  assert.ok(rollPool(pool, 1) !== null);
  const counts = new Map<string, number>();
  for (let i = 0; i < 20000; i++) {
    const id = rollPool(pool, i / 20000)!;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const entry of pool.entries) {
    const observed = (counts.get(entry.speciesId) ?? 0) / 20000;
    assert.ok(Math.abs(observed - chanceOf(pool, entry.speciesId)) < 0.01);
  }
});

console.log("\nEconomy");
check("production scales with level, tier and rarity", () => {
  const flat = make("placeholder-1");
  const base = coinsPerHour(pack, flat);
  assert.ok(coinsPerHour(pack, { ...flat, level: 10 }) > base);
  assert.ok(coinsPerHour(pack, { ...flat, tier: 3 }) > coinsPerHour(pack, { ...flat, tier: 2 }));
  assert.ok(coinsPerHour(pack, make("placeholder-4")) > base);
});

check("banked coins are capped at the storage limit", () => {
  const d = make("placeholder-1");
  const rate = coinsPerHour(pack, d);
  assert.ok(Math.abs(pendingCoins(pack, d, NOW + 3_600_000) - rate) <= 1);
  assert.strictEqual(
    pendingCoins(pack, d, NOW + 3_600_000 * 500),
    Math.round(rate * pack.balance.coinStorageHours),
  );
});

check("xp curve rises and rarity makes it steeper", () => {
  const common = make("placeholder-1");
  const legendary = make("placeholder-5");
  assert.ok(xpToNextLevel(pack, { ...common, level: 5 }) > xpToNextLevel(pack, common));
  assert.ok(xpToNextLevel(pack, legendary) > xpToNextLevel(pack, common));
});

console.log("\nIndividual value");
check("the roll stays inside 0-31", () => {
  for (let i = 0; i < 2000; i++) {
    const d = createDragon(pack, "placeholder-1", { source: "bred", now: NOW });
    assert.ok(Number.isInteger(d.iv), `iv is not an integer: ${d.iv}`);
    assert.ok(d.iv >= IV_MIN && d.iv <= IV_MAX, `iv out of range: ${d.iv}`);
  }
});

check("both ends of the range are reachable", () => {
  assert.strictEqual(createDragon(pack, "placeholder-1", { source: "bred", rng: () => 0 }).iv, IV_MIN);
  assert.strictEqual(
    createDragon(pack, "placeholder-1", { source: "bred", rng: () => 0.9999 }).iv,
    IV_MAX,
  );
});

check("a perfect roll pays its full magnitude", () => {
  const worst = make("placeholder-1", IV_MIN);
  const best = make("placeholder-1", IV_MAX);
  assert.strictEqual(ivBonus(pack, worst, "production"), 0);
  assert.ok(
    Math.abs(ivBonus(pack, best, "production") - pack.iv.productionMagnitude) < 1e-9,
  );
  const ratio = coinsPerHour(pack, best) / coinsPerHour(pack, worst);
  assert.ok(Math.abs(ratio - (1 + pack.iv.productionMagnitude)) < 0.02);
});

check("a middling roll pays a proportional share", () => {
  const mid = make("placeholder-1", 16);
  const expected = pack.iv.productionMagnitude * (16 / IV_MAX);
  assert.ok(Math.abs(ivBonus(pack, mid, "production") - expected) < 1e-9);
});

check("growth magnitude is honoured when set", () => {
  const tuned = { ...pack, iv: { ...pack.iv, growthMagnitude: 0.5 } };
  const worst = make("placeholder-1", IV_MIN);
  const best = make("placeholder-1", IV_MAX);
  // Kept under the first level threshold so the comparison is of raw xp, not
  // of whatever remainder is left after a level-up.
  const small = 30;
  assert.ok(grantXp(tuned, best, small).dragon.xp > grantXp(tuned, worst, small).dragon.xp);
  assert.strictEqual(
    grantXp(pack, best, small).dragon.xp,
    grantXp(pack, worst, small).dragon.xp,
  );
});

check("the value never changes after birth", () => {
  const d = make("placeholder-1", 12);
  assert.strictEqual(grantXp(pack, d, 5000).dragon.iv, 12);
});

check("ivs do not pass down from parents", () => {
  const save = newGame(pack, NOW);
  const perfect = save.dragons.map((d) => ({ ...d, iv: IV_MAX }));
  const seeded = { ...save, dragons: perfect, roostCapacity: 9 };
  let allPerfect = true;
  for (let i = 0; i < 60; i++) {
    const bred = startBreeding(pack, seeded, perfect[0].id, perfect[1].id, NOW);
    const hatched = claimHatchling(pack, bred.save, LATER);
    const child = hatched.save.dragons[hatched.save.dragons.length - 1];
    if (child.iv !== IV_MAX) allPerfect = false;
  }
  assert.ok(!allPerfect, "hatchlings appear to inherit parent IVs");
});

check("older saves are repaired rather than dropped", () => {
  const save = newGame(pack, NOW);
  const legacy = {
    ...save,
    dragons: save.dragons.map((d) => {
      const copy: Record<string, unknown> = { ...d };
      delete copy.iv;
      copy.traits = { productionBonus: 0.1, growthRate: 1, marks: [] };
      copy.ivs = { vigour: 20, appetite: 4 };
      return copy as unknown as Dragon;
    }),
  };
  const fixed = migrateSave(pack, legacy);
  assert.strictEqual(fixed.dragons.length, save.dragons.length);
  for (const d of fixed.dragons) {
    assert.ok(!("traits" in d));
    assert.ok(!("ivs" in d));
    assert.ok(d.iv >= IV_MIN && d.iv <= IV_MAX);
  }
});

console.log("\nIncubation");
check("each dragon can set its own incubation", () => {
  assert.strictEqual(incubationSeconds(pack, "placeholder-1"), 60);
  assert.strictEqual(incubationSeconds(pack, "placeholder-5"), 3600);
  assert.ok(
    incubationSeconds(pack, "placeholder-4") > incubationSeconds(pack, "placeholder-3"),
  );
});

check("a dragon with no time set falls back to the default", () => {
  const stripped = {
    ...pack,
    species: {
      ...pack.species,
      "placeholder-1": { ...pack.species["placeholder-1"], incubationSeconds: undefined },
    },
  };
  assert.strictEqual(
    incubationSeconds(stripped, "placeholder-1"),
    pack.balance.defaultIncubationSeconds,
  );
});

check("the egg timer matches the dragon inside it", () => {
  const save = { ...newGame(pack, NOW), roostCapacity: 9 };
  const [a, b] = save.dragons;
  const nest = startBreeding(pack, save, a.id, b.id, NOW, () => 0.1).save.breeding!;
  assert.strictEqual(
    nest.readyAt - nest.startedAt,
    incubationSeconds(pack, nest.resultSpeciesId) * 1000,
  );
});

check("an egg cannot be hatched early", () => {
  const save = { ...newGame(pack, NOW), roostCapacity: 9 };
  const [a, b] = save.dragons;
  const bred = startBreeding(pack, save, a.id, b.id, NOW, () => 0.1);
  const early = claimHatchling(pack, bred.save, NOW + 1000);
  assert.ok(!early.ok);
  assert.match(early.message, /not hatched/);
});

console.log("\nActions");
check("a fresh save has starters and discoveries", () => {
  const save = newGame(pack, NOW);
  assert.strictEqual(save.dragons.length, 2);
  assert.strictEqual(save.discovered.length, 2);
  assert.strictEqual(save.coins, pack.balance.startingCoins);
});

check("feeding spends food and grants levels", () => {
  const save = newGame(pack, NOW);
  const r = feed(pack, { ...save, food: 500 }, save.dragons[0].id, "food-1", 10);
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.save.food, 450);
  assert.ok(r.save.dragons[0].level > 1);
});

check("feeding without food is refused", () => {
  const save = { ...newGame(pack, NOW), food: 0 };
  const r = feed(pack, save, save.dragons[0].id, "food-1", 1);
  assert.ok(!r.ok);
  assert.match(r.message, /Not enough food/);
});

check("breeding then hatching adds a dragon", () => {
  const save = newGame(pack, NOW);
  const [a, b] = save.dragons;
  const bred = startBreeding(pack, save, a.id, b.id, NOW, () => 0.1);
  assert.ok(bred.ok, bred.message);
  const hatched = claimHatchling(pack, bred.save, LATER, () => 0.5);
  assert.ok(hatched.ok, hatched.message);
  assert.strictEqual(hatched.save.dragons.length, 3);
  assert.strictEqual(hatched.save.dragons[2].generation, 2);
  assert.deepStrictEqual(hatched.save.dragons[2].parentIds, [a.id, b.id]);
});

check("a full roost blocks breeding", () => {
  const save = { ...newGame(pack, NOW), roostCapacity: 2 };
  const [a, b] = save.dragons;
  const r = startBreeding(pack, save, a.id, b.id, NOW, () => 0.1);
  assert.ok(!r.ok);
  assert.match(r.message, /full/);
});

check("merging consumes exactly the required duplicates", () => {
  let save = newGame(pack, NOW);
  const target = save.dragons[0];
  const cost = mergeCost(pack, target)!;
  for (let i = 0; i < cost; i++) {
    save = { ...save, dragons: [...save.dragons, make(target.speciesId)] };
  }
  const before = save.dragons.length;
  const r = merge(pack, save, target.id);
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.save.dragons.length, before - cost);
  assert.strictEqual(r.save.dragons.find((d) => d.id === target.id)!.tier, 2);
});

check("merging eats the weakest duplicates first", () => {
  let save = newGame(pack, NOW);
  const target = { ...save.dragons[0], iv: 5 };
  save = { ...save, dragons: [target, save.dragons[1]] };
  const strong = { ...make(target.speciesId, IV_MAX), id: "keep-me" };
  const weak = { ...make(target.speciesId, IV_MIN), id: "eat-me" };
  save = { ...save, dragons: [...save.dragons, strong, weak] };
  const cost = mergeCost(pack, target)!;
  assert.strictEqual(cost, 2, "base set expects 2 duplicates for tier 2");
  const r = merge(pack, save, target.id);
  assert.ok(r.ok, r.message);
  assert.ok(!r.save.dragons.some((d) => d.id === "eat-me"));
});

check("locked duplicates are never eaten", () => {
  let save = newGame(pack, NOW);
  const target = save.dragons[0];
  const cost = mergeCost(pack, target)!;
  for (let i = 0; i < cost; i++) {
    save = { ...save, dragons: [...save.dragons, { ...make(target.speciesId), locked: true }] };
  }
  const r = merge(pack, save, target.id);
  assert.ok(!r.ok);
  assert.match(r.message, /unlocked duplicates/);
});

check("merging across different tiers is refused", () => {
  let save = newGame(pack, NOW);
  const target = save.dragons[0];
  save = { ...save, dragons: [...save.dragons, { ...make(target.speciesId), tier: 2 }] };
  assert.ok(!merge(pack, save, target.id).ok);
});

console.log(`\n${passed} checks passed\n`);
