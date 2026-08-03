import assert from "node:assert";
import { buildPool, chanceOf, probeDragon, rollPool } from "../src/game/breeding";
import { defaultContentPack } from "../src/game/content";
import {
  coinCap,
  coinsPerHour,
  foodToNextLevel,
  hoursToFill,
  marketCooldownLeft,
  nextBakeryCost,
  nextRoostSlotCost,
  ovenState,
  powerOf,
  tierOneCost,
  grantXp,
  incubationSeconds,
  ivBonus,
  mergeCost,
  pendingCoins,
  xpToNextLevel,
} from "../src/game/economy";
import {
  buildBakery,
  buySpecies,
  claimHatchling,
  ensureViable,
  collectBatch,
  createDragon,
  feed,
  feedToNextLevel,
  merge,
  nestCapacityOf,
  nestsOf,
  newGame,
  nextNestCost,
  pairKey,
  perchedCount,
  perchesFull,
  rollIv,
  setAdminMode,
  startBatch,
  startBreeding,
} from "../src/game/engine";
import { applyAction } from "../src/game/actions";
import { cleanName, NAME_MAX } from "../src/game/leaderboard";
import { redactPack } from "../src/game/redact";
import { migrateSave, validatePack } from "../src/game/storage";
import { branchUnder, childrenOf, isWithin, removeTaxon, roots, taxonPath } from "../src/game/taxonomy";
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
const ctx = (isAdmin = false) => ({ now: NOW, rng: () => 0.5, isAdmin });

/**
 * A save with dragons in it. New keepers now start empty — with coins for one
 * Fire Dragon and nothing else — so tests that need a roost stock one.
 */
const seeded = (species: string[] = ["fire-dragon", "earth-dragon"]) => {
  let save = newGame(pack, NOW);
  for (const id of species)
    save = applyAction(pack, save, { type: "grantDragon", speciesId: id }, ctx(true)).save;
  return save;
};

const make = (speciesId: string, iv = 0) => ({
  ...createDragon(pack, speciesId, { now: NOW, rng: () => 0.5 }),
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
  assert.strictEqual(taxonPath(pack, "fire"), "Dragon › Elemental › Base Elements › Fire");
  assert.ok(isWithin(pack, "fire", "dragon"));
  assert.ok(!isWithin(pack, "fire", "water"));
});

check("deleting a branch rehomes its dragons and sub-branches", () => {
  const { pack: after, error } = removeTaxon(pack, "elemental", "dragon");
  assert.strictEqual(error, null);
  assert.strictEqual(after.taxa["elemental"], undefined);
  // Its direct children move up, not its grandchildren.
  assert.strictEqual(after.taxa["base-elements"].parentId, "dragon");
  assert.strictEqual(after.taxa["hybrid"].parentId, "dragon");
  assert.strictEqual(after.taxa["fire"].parentId, "base-elements");
  assert.strictEqual(Object.keys(after.species).length, Object.keys(pack.species).length);
});

check("deleting a branch moves the dragons sitting on it", () => {
  const { pack: after, error } = removeTaxon(pack, "fire", "elemental");
  assert.strictEqual(error, null);
  assert.strictEqual(after.species["fire-dragon"].taxonId, "elemental");
});

check("dragons cannot be stranded at the top level", () => {
  const { error } = removeTaxon(pack, "fire", null);
  assert.ok(error);
  assert.match(error!, /need a branch/);
});

check("an empty branch deletes cleanly", () => {
  const stripped = {
    ...pack,
    species: Object.fromEntries(
      Object.entries(pack.species).filter(([, s]) => s.taxonId !== "air"),
    ),
  };
  const { pack: after, error } = removeTaxon(stripped, "air", null);
  assert.strictEqual(error, null);
  assert.strictEqual(after.taxa["air"], undefined);
});

check("a destination inside the doomed branch is refused", () => {
  const { error } = removeTaxon(pack, "elemental", "fire");
  assert.ok(error);
});

check("rules pointing at a deleted branch are redirected", () => {
  // No shipped rule uses a taxon matcher, so this adds one to aim at the branch.
  const withTaxonRule = {
    ...pack,
    breedingRules: [
      ...pack.breedingRules,
      {
        id: "rule-taxon-probe",
        label: "Probe",
        a: { kind: "taxon" as const, taxonId: "elemental", includeDescendants: true },
        b: { kind: "taxon" as const, taxonId: "elemental", includeDescendants: true },
        outcomes: [{ speciesId: "fire-dragon", weight: 5 }],
        enabled: true,
      },
    ],
  };
  const { pack: after } = removeTaxon(withTaxonRule, "elemental", "dragon");
  const rule = after.breedingRules.find((r) => r.id === "rule-taxon-probe")!;
  assert.strictEqual(rule.a.kind, "taxon");
  assert.strictEqual((rule.a as { taxonId: string }).taxonId, "dragon");
  assert.strictEqual((rule.b as { taxonId: string }).taxonId, "dragon");
});

check("removal leaves the pack valid", () => {
  const { pack: after } = removeTaxon(pack, "elemental", "dragon");
  assert.deepStrictEqual(validatePack(after).filter((i) => i.level === "error"), []);
});

console.log("\nBreeding pool");
const one = make("fire-dragon");
const two = make("earth-dragon");
const three = make("air-dragon");

check("parents are always in the pool", () => {
  const pool = buildPool(pack, one, two);
  assert.ok(pool.entries.some((e) => e.speciesId === "fire-dragon"));
  assert.ok(pool.entries.some((e) => e.speciesId === "earth-dragon"));
});

check("a named pair rule fires", () => {
  const pool = buildPool(pack, one, make("water-dragon"));
  assert.ok(pool.appliedRules.some((r) => r.id === "rule-example-species"));
});

check("air comes from fire and water", () => {
  const fire = make("fire-dragon");
  const water = make("water-dragon");
  assert.ok(chanceOf(buildPool(pack, fire, water), "air-dragon") > 0);
  // Not from any other pairing.
  assert.strictEqual(chanceOf(buildPool(pack, fire, make("earth-dragon")), "air-dragon"), 0);
  assert.strictEqual(chanceOf(buildPool(pack, fire, fire), "air-dragon"), 0);
});

check("no dragon carries a tag", () => {
  for (const s of Object.values(pack.species))
    assert.deepStrictEqual(s.tags, [], `${s.name} still has tags`);
});

check("base elements are their own branch inside Elemental", () => {
  // Membership is by placement, not by a list — Inferno sits inside Fire and so
  // counts, which is what lets a dragon be adopted into an element.
  const base = Object.values(pack.species)
    .filter((s) => isWithin(pack, s.taxonId, "base-elements"))
    .map((s) => s.id)
    .sort();
  assert.deepStrictEqual(base, [
    "air-dragon",
    "earth-dragon",
    "fire-dragon",
    "inferno-dragon",
    "metal-dragon",
    "sand-dragon",
    "water-dragon",
  ]);
});

check("hybrids sit under Elemental too", () => {
  for (const id of ["lava-dragon", "elemental-dragon"]) {
    const s = pack.species[id];
    assert.ok(isWithin(pack, s.taxonId, "elemental"), `${s.name} left the branch`);
    assert.ok(
      !isWithin(pack, s.taxonId, "base-elements"),
      `${s.name} counts as a base element`,
    );
  }
});

check("the elemental dragon needs two distinct elements", () => {
  const combos: [string, string][] = [
    ["fire-dragon", "water-dragon"],
    ["fire-dragon", "earth-dragon"],
    ["earth-dragon", "water-dragon"],
  ];
  for (const [a, b] of combos) {
    assert.ok(
      chanceOf(buildPool(pack, make(a), make(b)), "elemental-dragon") > 0,
      `${a} x ${b} should be able to produce one`,
    );
  }
  // Two of the same kind must not.
  for (const id of ["fire-dragon", "earth-dragon", "water-dragon"]) {
    assert.strictEqual(
      chanceOf(buildPool(pack, make(id), make(id)), "elemental-dragon"),
      0,
      `${id} paired with itself should not`,
    );
  }
});

check("the elemental dragon stays rare", () => {
  const pool = buildPool(pack, make("fire-dragon"), make("earth-dragon"));
  const odds = chanceOf(pool, "elemental-dragon");
  assert.ok(odds > 0 && odds < 0.05, `odds were ${odds}`);
});

check("distinctness is enforced by the condition, not the matcher", () => {
  const rule = pack.breedingRules.find((r) => r.id === "rule-elemental-cross")!;
  assert.strictEqual(rule.conditions?.differentBranchUnder, "base-elements");
  const relaxed = {
    ...pack,
    breedingRules: pack.breedingRules.map((r) =>
      r.id === "rule-elemental-cross" ? { ...r, conditions: undefined } : r,
    ),
  };
  const fire = make("fire-dragon");
  assert.ok(chanceOf(buildPool(relaxed, fire, fire), "elemental-dragon") > 0);
});

check("a tag rule crosses branches", () => {
  // Built here rather than shipped, so the engine stays covered without the
  // base set carrying an example combo nobody asked for.
  const tagged = {
    ...pack,
    species: {
      ...pack.species,
      "fire-dragon": { ...pack.species["fire-dragon"], tags: ["scaled"] },
      "life-dragon": { ...pack.species["life-dragon"], tags: ["scaled"] },
    },
    breedingRules: [
      ...pack.breedingRules,
      {
        id: "rule-tag-probe",
        label: "Tagged pair",
        a: { kind: "tag" as const, tag: "scaled" },
        b: { kind: "tag" as const, tag: "scaled" },
        outcomes: [{ speciesId: "air-dragon", weight: 10 }],
        priority: 0,
        enabled: true,
      },
    ],
  };
  // Fire and Life sit in different branches entirely, so only the tag can match.
  const across = buildPool(tagged, make("fire-dragon"), make("life-dragon"));
  assert.ok(across.appliedRules.some((r) => r.id === "rule-tag-probe"));
  const untagged = buildPool(tagged, make("water-dragon"), make("earth-dragon"));
  assert.ok(!untagged.appliedRules.some((r) => r.id === "rule-tag-probe"));
});

check("rules match in either order", () => {
  const fwd = buildPool(pack, one, two);
  const rev = buildPool(pack, two, one);
  assert.strictEqual(fwd.totalWeight, rev.totalWeight);
});

check("weights sum and probabilities total 1", () => {
  const pool = buildPool(pack, one, two);
  const sum = pool.entries.reduce((n, e) => n + e.weight, 0);
  assert.strictEqual(sum, pool.totalWeight);
  const p = pool.entries.reduce((n, e) => n + chanceOf(pool, e.speciesId), 0);
  assert.ok(Math.abs(p - 1) < 1e-9);
});

check("tier conditions gate a rule", () => {
  const one = make("earth-dragon");
  const two = make("fire-dragon");
  // The Stone-and-Sea style gate: nothing below tier 2 reaches an Elemental.
  const gated = {
    ...pack,
    breedingRules: pack.breedingRules.map((r) =>
      r.id === "rule-elemental-cross"
        ? { ...r, conditions: { ...r.conditions, minTier: 2 } }
        : r,
    ),
  };
  assert.strictEqual(chanceOf(buildPool(gated, one, two), "elemental-dragon"), 0);
  const raised = buildPool(gated, { ...one, tier: 2 }, { ...two, tier: 2 });
  assert.ok(chanceOf(raised, "elemental-dragon") > 0);
});

check("no pairing can ever be a certainty", () => {
  // Rules only add weight, so a parent is always somewhere in the pool.
  const ids = Object.keys(pack.species);
  for (const a of ids) {
    for (const b of ids) {
      for (const iv of [0, 15, 31]) {
        const pool = buildPool(
          pack,
          { ...make(a), iv, tier: 3 },
          { ...make(b), iv, tier: 3 },
        );
        // A parent always keeps a real share of the pool — the thinnest case in
        // the base set is two flawless parents, where Perfection takes 43%. Two
        // of the same kind can of course return that kind outright.
        const parents = chanceOf(pool, a) + chanceOf(pool, b);
        assert.ok(parents > 0.4, `${a} x ${b} at IV ${iv} left parents at ${parents}`);
        for (const entry of pool.entries) {
          if (entry.speciesId === a || entry.speciesId === b) continue;
          assert.ok(
            chanceOf(pool, entry.speciesId) < 1,
            `${a} x ${b} at IV ${iv} guaranteed ${entry.speciesId}`,
          );
        }
      }
    }
  }
});

check("roll boundaries land in the right bucket", () => {
  const pool = buildPool(pack, one, two);
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

console.log("\nCombos");
const combo = (a: string, b: string, result: string, iv = 5) => {
  const pool = buildPool(pack, { ...make(a), iv },
    { ...make(b), iv },
  );
  return chanceOf(pool, result);
};

check("inferno counts as a base element", () => {
  assert.strictEqual(pack.species["inferno-dragon"].taxonId, "fire");
  for (const other of ["water-dragon", "earth-dragon", "air-dragon"])
    assert.ok(
      combo("inferno-dragon", other, "elemental-dragon") > 0,
      `inferno x ${other}`,
    );
});

check("metal is adopted into earth", () => {
  assert.strictEqual(pack.species["metal-dragon"].taxonId, "earth");
  assert.strictEqual(combo("metal-dragon", "earth-dragon", "elemental-dragon"), 0);
  for (const other of ["fire-dragon", "water-dragon", "air-dragon"])
    assert.ok(combo("metal-dragon", other, "elemental-dragon") > 0, `metal x ${other}`);
});

check("metal is an earth dragon", () => {
  assert.strictEqual(pack.species["metal-dragon"].taxonId, "earth");
  assert.strictEqual(combo("metal-dragon", "earth-dragon", "elemental-dragon"), 0);
  for (const other of ["fire-dragon", "water-dragon", "air-dragon"])
    assert.ok(combo("metal-dragon", other, "elemental-dragon") > 0, `metal x ${other}`);
});

check("two dragons of the same element cannot cross", () => {
  // Inferno is filed inside Fire, so it is the same element as a Fire Dragon
  // however different the two are as dragons.
  assert.strictEqual(combo("fire-dragon", "inferno-dragon", "elemental-dragon"), 0);
  for (const id of ["fire-dragon", "earth-dragon", "water-dragon", "air-dragon"])
    assert.strictEqual(combo(id, id, "elemental-dragon"), 0, `${id} with itself`);
});

check("the element is found however deeply a dragon is nested", () => {
  // A dragon two levels inside Fire still reads as Fire.
  const deep = {
    ...pack,
    taxa: {
      ...pack.taxa,
      ember: {
        id: "ember",
        name: "Ember",
        parentId: "fire",
        rank: "",
        description: "",
        custom: {},
      },
    },
    species: {
      ...pack.species,
      "inferno-dragon": { ...pack.species["inferno-dragon"], taxonId: "ember" },
    },
  };
  assert.strictEqual(branchUnder(deep, "ember", "base-elements"), "fire");
  const pool = buildPool(deep, make("fire-dragon"), make("inferno-dragon"));
  assert.strictEqual(chanceOf(pool, "elemental-dragon"), 0);
  const across = buildPool(deep, make("water-dragon"), make("inferno-dragon"));
  assert.ok(chanceOf(across, "elemental-dragon") > 0);
});

check("dragons outside the branch cannot stand in for a base element", () => {
  for (const id of ["lava-dragon", "plant-dragon", "life-dragon", "monster-dragon"]) {
    assert.strictEqual(
      combo("fire-dragon", id, "elemental-dragon"),
      0,
      `fire x ${id} should not reach an Elemental`,
    );
  }
});

check("earth and fire make lava about one time in five", () => {
  const odds = combo("earth-dragon", "fire-dragon", "lava-dragon");
  assert.ok(odds > 0.17 && odds < 0.24, `odds were ${odds}`);
  assert.strictEqual(combo("earth-dragon", "water-dragon", "lava-dragon"), 0);
});

check("reaching max tier costs 360 tier ones", () => {
  // Each step eats n duplicates and keeps one, so the cost compounds:
  // 3 x 4 x 5 x 6 with merge costs of 2/3/4/5.
  assert.strictEqual(tierOneCost(pack, "fire-dragon", 2), 3);
  assert.strictEqual(tierOneCost(pack, "fire-dragon", 3), 12);
  assert.strictEqual(tierOneCost(pack, "fire-dragon", 4), 60);
  assert.strictEqual(tierOneCost(pack, "fire-dragon", pack.balance.maxTier), 360);
});

check("earth and water make plant", () => {
  assert.ok(combo("earth-dragon", "water-dragon", "plant-dragon") > 0.1);
  assert.strictEqual(combo("fire-dragon", "water-dragon", "plant-dragon"), 0);
});

check("two plants make life", () => {
  assert.ok(combo("plant-dragon", "plant-dragon", "life-dragon") > 0);
  assert.strictEqual(combo("plant-dragon", "fire-dragon", "life-dragon"), 0);
  assert.strictEqual(combo("water-dragon", "water-dragon", "life-dragon"), 0);
});

check("fire and plant make inferno far more often than fire alone", () => {
  const paired = combo("fire-dragon", "plant-dragon", "inferno-dragon");
  const alone = combo("fire-dragon", "fire-dragon", "inferno-dragon");
  assert.ok(paired > 0.1, `paired odds were ${paired}`);
  assert.ok(alone > 0 && alone < 0.02, `self odds were ${alone}`);
  assert.ok(paired > alone * 10);
});

check("two flawless parents give about a one in five shot", () => {
  const odds = combo("fire-dragon", "water-dragon", "perfection-dragon", 31);
  assert.ok(odds > 0.17 && odds < 0.25, `odds were ${odds}`);
});

check("perfection needs two flawless parents", () => {
  assert.ok(combo("fire-dragon", "water-dragon", "perfection-dragon", 31) > 0);
  // One point short on both and it cannot happen at all.
  assert.strictEqual(combo("fire-dragon", "water-dragon", "perfection-dragon", 30), 0);
  // One flawless parent still leaves the long-shot rule, but far below the pair.
  const oneFlawless = buildPool(
    pack,
    { ...make("fire-dragon"), iv: 31 },
    { ...make("water-dragon"), iv: 30 },
  );
  const half = chanceOf(oneFlawless, "perfection-dragon");
  assert.ok(half > 0 && half < 0.05, `half odds were ${half}`);
});

check("elemental and perfection make ether", () => {
  assert.ok(combo("elemental-dragon", "perfection-dragon", "ether-dragon") > 0.1);
  assert.strictEqual(combo("elemental-dragon", "elemental-dragon", "ether-dragon"), 0);
  assert.strictEqual(combo("perfection-dragon", "perfection-dragon", "ether-dragon"), 0);
  assert.strictEqual(combo("elemental-dragon", "monster-dragon", "ether-dragon"), 0);
});

check("ether sits behind perfection", () => {
  // No rule reaches it without a Perfection parent. Ether itself is skipped —
  // pairing it with anything leaves it in the pool as a parent, not a result.
  for (const id of Object.keys(pack.species)) {
    if (id === "perfection-dragon" || id === "ether-dragon") continue;
    assert.strictEqual(
      combo("elemental-dragon", id, "ether-dragon"),
      0,
      `elemental x ${id}`,
    );
  }
});

check("transcendent splits into physical and duality", () => {
  assert.strictEqual(pack.taxa["physical"].parentId, "transcendent");
  assert.strictEqual(pack.taxa["duality"].parentId, "transcendent");
  for (const id of ["perfection-dragon", "corruption-dragon"]) {
    const s = pack.species[id];
    assert.strictEqual(s.taxonId, "duality", `${s.name} is not in Duality`);
    assert.ok(isWithin(pack, s.taxonId, "transcendent"));
  }
  // Nothing sits loose on the Transcendent node itself any more.
  assert.deepStrictEqual(
    Object.values(pack.species).filter((s) => s.taxonId === "transcendent"),
    [],
  );
});

check("special sits inside elemental", () => {
  assert.strictEqual(pack.taxa["special"].parentId, "elemental");
  for (const id of ["life-dragon", "monster-dragon"]) {
    const s = pack.species[id];
    assert.ok(isWithin(pack, s.taxonId, "elemental"), `${s.name} is outside Elemental`);
    // Still not a base element, so the cross rule cannot pick it up.
    assert.ok(!isWithin(pack, s.taxonId, "base-elements"), `${s.name} counts as base`);
  }
});

check("the elemental cross rule matches only base elements", () => {
  const rule = pack.breedingRules.find((r) => r.id === "rule-elemental-cross")!;
  for (const m of [rule.a, rule.b]) {
    assert.strictEqual(m.kind, "taxon");
    assert.strictEqual((m as { taxonId: string }).taxonId, "base-elements");
  }
  // Anything else under Elemental is excluded. The Elemental Dragon itself is
  // skipped, since pairing with it leaves it in the pool as a parent.
  for (const id of ["life-dragon", "monster-dragon", "lava-dragon", "plant-dragon"])
    assert.strictEqual(combo("fire-dragon", id, "elemental-dragon"), 0, `fire x ${id}`);
});

check("life is a branch inside special", () => {
  assert.strictEqual(pack.taxa["life"].parentId, "special");
  for (const id of ["life-dragon", "monster-dragon", "plant-dragon"]) {
    assert.strictEqual(pack.species[id].taxonId, "life");
    assert.ok(isWithin(pack, "life", "special"));
    assert.ok(isWithin(pack, "life", "elemental"));
  }
  // Nothing sits loose on Special itself.
  assert.deepStrictEqual(
    Object.values(pack.species).filter((s) => s.taxonId === "special"),
    [],
  );
});

check("air and earth make sand", () => {
  assert.ok(combo("air-dragon", "earth-dragon", "sand-dragon") > 0.17);
  assert.strictEqual(combo("fire-dragon", "earth-dragon", "sand-dragon"), 0);
  assert.strictEqual(combo("air-dragon", "water-dragon", "sand-dragon"), 0);
});

check("sand is an earth dragon", () => {
  assert.strictEqual(pack.species["sand-dragon"].taxonId, "earth");
  // Filed under Earth, so it is the same element as an Earth Dragon and the two
  // cannot cross for an Elemental.
  assert.strictEqual(combo("sand-dragon", "earth-dragon", "elemental-dragon"), 0);
  assert.ok(combo("sand-dragon", "water-dragon", "elemental-dragon") > 0);
});

check("sand and anything in the fire branch makes glass", () => {
  for (const id of ["fire-dragon", "inferno-dragon"])
    assert.ok(combo("sand-dragon", id, "glass-dragon") > 0.17, `sand x ${id}`);
});

check("lava is a slimmer route to glass", () => {
  const branch = combo("sand-dragon", "fire-dragon", "glass-dragon");
  const viaLava = combo("sand-dragon", "lava-dragon", "glass-dragon");
  assert.ok(viaLava > 0 && viaLava < 0.06, `lava odds were ${viaLava}`);
  assert.ok(branch > viaLava * 4);
});

check("nothing else reaches glass", () => {
  for (const id of Object.keys(pack.species)) {
    if (["sand-dragon", "glass-dragon"].includes(id)) continue;
    assert.strictEqual(combo("water-dragon", id, "glass-dragon"), 0, `water x ${id}`);
  }
});

check("corruption and life make monster", () => {
  assert.ok(combo("corruption-dragon", "life-dragon", "monster-dragon") > 0.1);
  assert.strictEqual(combo("corruption-dragon", "corruption-dragon", "monster-dragon"), 0);
  assert.strictEqual(combo("life-dragon", "life-dragon", "monster-dragon"), 0);
  assert.strictEqual(combo("perfection-dragon", "life-dragon", "monster-dragon"), 0);
});

check("elemental and earth make metal", () => {
  assert.ok(combo("elemental-dragon", "earth-dragon", "metal-dragon") > 0.1);
  // Neither parent alone, nor the other elements, reach it.
  assert.strictEqual(combo("earth-dragon", "earth-dragon", "metal-dragon"), 0);
  assert.strictEqual(combo("elemental-dragon", "fire-dragon", "metal-dragon"), 0);
  assert.strictEqual(combo("elemental-dragon", "water-dragon", "metal-dragon"), 0);
});

check("metal sits behind the elemental dragon", () => {
  // Nothing purely elemental can produce it, so it is gated on that step.
  const elements = ["fire-dragon", "earth-dragon", "water-dragon", "air-dragon"];
  for (const a of elements)
    for (const b of elements)
      assert.strictEqual(combo(a, b, "metal-dragon"), 0, `${a} x ${b}`);
});

check("two hollow parents make corruption", () => {
  assert.ok(combo("fire-dragon", "water-dragon", "corruption-dragon", 0) > 0);
  // One point on either parent and the rule stops firing.
  assert.strictEqual(combo("fire-dragon", "water-dragon", "corruption-dragon", 1), 0);
  // One hollow parent keeps only the long-shot rule.
  const oneHollow = buildPool(
    pack,
    { ...make("fire-dragon"), iv: 0 },
    { ...make("water-dragon"), iv: 1 },
  );
  const half = chanceOf(oneHollow, "corruption-dragon");
  assert.ok(half > 0 && half < 0.05, `half odds were ${half}`);
});

check("corruption and perfection cannot both fire", () => {
  assert.strictEqual(combo("fire-dragon", "water-dragon", "perfection-dragon", 0), 0);
  assert.strictEqual(combo("fire-dragon", "water-dragon", "corruption-dragon", 31), 0);
});

check("corruption is the likelier of the two to see", () => {
  // Not because its weight is higher — it is lower — but because a 0 is
  // ordinary and a 31 is not. This asserts the weights, not the roll odds.
  const corruption = combo("fire-dragon", "water-dragon", "corruption-dragon", 0);
  const perfection = combo("fire-dragon", "water-dragon", "perfection-dragon", 31);
  assert.ok(corruption < perfection, `${corruption} should sit below ${perfection}`);
});

check("one flawless parent gives a slim chance", () => {
  const pool = buildPool(
    pack,
    { ...make("fire-dragon"), iv: 31 },
    { ...make("water-dragon"), iv: 15 },
  );
  const half = chanceOf(pool, "perfection-dragon");
  const both = combo("fire-dragon", "water-dragon", "perfection-dragon", 31);
  assert.ok(half > 0 && half < 0.05, `half odds were ${half}`);
  assert.ok(both > half * 10, "two flawless parents should dwarf one");
});

check("one hollow parent gives a slim chance", () => {
  const pool = buildPool(
    pack,
    { ...make("fire-dragon"), iv: 0 },
    { ...make("water-dragon"), iv: 15 },
  );
  const half = chanceOf(pool, "corruption-dragon");
  const both = combo("fire-dragon", "water-dragon", "corruption-dragon", 0);
  assert.ok(half > 0 && half < 0.05, `half odds were ${half}`);
  assert.ok(both > half * 5, "two hollow parents should dwarf one");
});

check("neither extreme means neither dragon", () => {
  const pool = buildPool(
    pack,
    { ...make("fire-dragon"), iv: 15 },
    { ...make("water-dragon"), iv: 20 },
  );
  assert.strictEqual(chanceOf(pool, "perfection-dragon"), 0);
  assert.strictEqual(chanceOf(pool, "corruption-dragon"), 0);
});

check("perfection is open to any pairing, not just elements", () => {
  assert.ok(combo("plant-dragon", "plant-dragon", "perfection-dragon", 31) > 0);
});

check("the odds calculator matches a real breed", () => {
  // probeDragon is what Admin uses; it must build the same pool as an owned pair.
  const owned = buildPool(pack, make("fire-dragon"), make("water-dragon"));
  const probed = buildPool(pack, probeDragon("fire-dragon", { tier: 1, level: 1, iv: 0 }),
    probeDragon("water-dragon", { tier: 1, level: 1, iv: 0 }),
  );
  assert.strictEqual(probed.totalWeight, owned.totalWeight);
  assert.deepStrictEqual(
    probed.entries.map((e) => [e.speciesId, e.weight]),
    owned.entries.map((e) => [e.speciesId, e.weight]),
  );
});

check("the calculator can see condition-gated rules", () => {
  const gated = {
    ...pack,
    breedingRules: pack.breedingRules.map((r) =>
      r.id === "rule-plant" ? { ...r, conditions: { minTier: 2 } } : r,
    ),
  };
  const low = buildPool(
    gated,
    probeDragon("earth-dragon", { tier: 1 }),
    probeDragon("water-dragon", { tier: 1 }),
  );
  assert.strictEqual(chanceOf(low, "plant-dragon"), 0);
  const high = buildPool(
    gated,
    probeDragon("earth-dragon", { tier: 2 }),
    probeDragon("water-dragon", { tier: 2 }),
  );
  assert.ok(chanceOf(high, "plant-dragon") > 0);
});

console.log("\nEconomy");
check("production scales with level and tier", () => {
  const flat = make("fire-dragon");
  const base = coinsPerHour(pack, flat);
  assert.ok(coinsPerHour(pack, { ...flat, level: 10 }) > base);
  assert.ok(coinsPerHour(pack, { ...flat, tier: 3 }) > coinsPerHour(pack, { ...flat, tier: 2 }));
  assert.ok(coinsPerHour(pack, make("water-dragon")) > base);
});

check("banked coins accrue at the stated rate, then stop at the cap", () => {
  const d = make("fire-dragon");
  const rate = coinsPerHour(pack, d);
  // Half the fill window, so the cap is not yet in play.
  const halfway = (hoursToFill(pack, d) / 2) * 3_600_000;
  assert.ok(Math.abs(pendingCoins(pack, d, NOW + halfway) - rate * (halfway / 3_600_000)) <= 1);
  assert.strictEqual(pendingCoins(pack, d, NOW + 3_600_000 * 500), coinCap(pack, d));
});

check("an introductory dragon fills in about twenty minutes", () => {
  const minutes = hoursToFill(pack, make("fire-dragon")) * 60;
  assert.ok(Math.abs(minutes - 20) < 1, `filled in ${minutes.toFixed(1)} minutes`);
});

check("introductory output is about three coins a minute", () => {
  const perMinute = coinsPerHour(pack, make("fire-dragon")) / 60;
  assert.ok(Math.abs(perMinute - 3) < 0.2, `earned ${perMinute.toFixed(2)} a minute`);
});

check("a fully raised introductory dragon reaches about twenty a minute", () => {
  const maxed = { ...make("fire-dragon"), level: pack.balance.maxLevel, tier: 5 };
  const perMinute = coinsPerHour(pack, maxed) / 60;
  assert.ok(Math.abs(perMinute - 20) < 1.5, `earned ${perMinute.toFixed(2)} a minute`);
});

check("better dragons hold longer before they stop", () => {
  const fire = hoursToFill(pack, make("fire-dragon"));
  const earth = hoursToFill(pack, make("earth-dragon"));
  const water = hoursToFill(pack, make("water-dragon"));
  assert.ok(water > earth && earth > fire);
});

check("xp curve rises, and a dragon can make its own steeper", () => {
  const common = make("fire-dragon");
  const steeper = make("monster-dragon");
  assert.ok(xpToNextLevel(pack, { ...common, level: 5 }) > xpToNextLevel(pack, common));
  assert.ok(xpToNextLevel(pack, steeper) > xpToNextLevel(pack, common));
});

check("a dragon can set its own storage hours", () => {
  const tuned = {
    ...pack,
    species: {
      ...pack.species,
      "fire-dragon": { ...pack.species["fire-dragon"], coinStorageHours: 2 },
    },
  };
  const d = make("fire-dragon");
  assert.strictEqual(coinCap(tuned, d), Math.round(coinsPerHour(tuned, d) * 2));
  // The override wins over the global setting, in whichever direction.
  const expected = coinsPerHour(pack, d) * pack.balance.coinStorageHours;
  assert.ok(Math.abs(coinCap(pack, d) - expected) < 1);
  assert.notStrictEqual(coinCap(tuned, d), coinCap(pack, d));
});

check("introductory dragons hit their pacing targets", () => {
  const fire = make("fire-dragon");
  // 3 coins a minute, filling in about 20 minutes, straight out of the shop.
  assert.ok(Math.abs(coinsPerHour(pack, fire) / 60 - 3) < 0.3);
  assert.ok(Math.abs(hoursToFill(pack, fire) * 60 - 20) < 2);

  // About 20 a minute once fully raised.
  const maxed = { ...fire, level: pack.balance.maxLevel, tier: pack.balance.maxTier };
  assert.ok(Math.abs(coinsPerHour(pack, maxed) / 60 - 20) < 2);
});

check("better dragons hold more before they stop", () => {
  const order = ["fire-dragon", "earth-dragon", "water-dragon", "air-dragon"];
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      hoursToFill(pack, make(order[i])) > hoursToFill(pack, make(order[i - 1])),
      `${order[i]} should outlast ${order[i - 1]}`,
    );
  }
});

check("a flat cap overrides the hours and does not scale", () => {
  const tuned = {
    ...pack,
    species: {
      ...pack.species,
      "fire-dragon": {
        ...pack.species["fire-dragon"],
        coinStorageHours: 99,
        coinCapacity: 500,
      },
    },
  };
  const low = make("fire-dragon");
  const high = { ...low, level: 30, tier: 4 };
  assert.strictEqual(coinCap(tuned, low), 500);
  assert.strictEqual(coinCap(tuned, high), 500);
  assert.ok(coinsPerHour(tuned, high) > coinsPerHour(tuned, low));
});

check("banked coins stop at the dragon's own cap", () => {
  const tuned = {
    ...pack,
    species: {
      ...pack.species,
      "fire-dragon": { ...pack.species["fire-dragon"], coinCapacity: 100 },
    },
  };
  const d = make("fire-dragon");
  assert.strictEqual(pendingCoins(tuned, d, NOW + 3_600_000 * 500), 100);
});

check("dragons with no limit set fall back to the global one", () => {
  const d = make("fire-dragon");
  assert.strictEqual(
    coinCap(pack, d),
    Math.round(coinsPerHour(pack, d) * pack.balance.coinStorageHours),
  );
});

check("level and tier fold into one power number", () => {
  const base = make("fire-dragon");
  assert.strictEqual(powerOf(pack, base), 1);
  assert.strictEqual(powerOf(pack, { ...base, level: 10 }), 10);
  const w = pack.balance.power.tierWeight;
  assert.strictEqual(powerOf(pack, { ...base, tier: 2 }), w);
  assert.strictEqual(powerOf(pack, { ...base, level: 5, tier: 3 }), 5 * w * w);
});

check("two dragons of equal power produce equally", () => {
  const w = pack.balance.power.tierWeight;
  const levelled = { ...make("fire-dragon"), level: w };
  const tiered = { ...make("fire-dragon"), level: 1, tier: 2 };
  assert.strictEqual(powerOf(pack, levelled), powerOf(pack, tiered));
  assert.strictEqual(coinsPerHour(pack, levelled), coinsPerHour(pack, tiered));
  assert.strictEqual(coinCap(pack, levelled), coinCap(pack, tiered));
});

check("power has diminishing returns", () => {
  const base = make("fire-dragon");
  const one = coinsPerHour(pack, base);
  const ten = coinsPerHour(pack, { ...base, level: 10 });
  const hundred = coinsPerHour(pack, { ...base, level: 100 });
  // Ten times the power must give less than ten times the output, twice over.
  assert.ok(ten < one * 10);
  assert.ok(hundred < ten * 10);
});

check("a fully raised weak dragon cannot out-earn a fresh strong one", () => {
  const maxedCommon = { ...make("fire-dragon", IV_MAX), level: pack.balance.maxLevel };
  const freshLegendary = make("monster-dragon", IV_MIN);
  assert.ok(
    coinsPerHour(pack, freshLegendary) > coinsPerHour(pack, maxedCommon),
    `raised ${coinsPerHour(pack, maxedCommon)} vs fresh ${coinsPerHour(pack, freshLegendary)}`,
  );
});

check("a tier step beats grinding levels", () => {
  const base = make("fire-dragon");
  const tiered = { ...base, tier: 2 };
  const levelled = { ...base, level: 5 };
  assert.ok(coinsPerHour(pack, tiered) > coinsPerHour(pack, levelled));
});

check("high tiers compound in tier 1 dragons", () => {
  const costs = pack.balance.mergeCosts;
  assert.strictEqual(tierOneCost(pack, "fire-dragon", 1), 1);
  assert.strictEqual(tierOneCost(pack, "fire-dragon", 2), costs[0] + 1);
  assert.strictEqual(tierOneCost(pack, "fire-dragon", 3), (costs[0] + 1) * (costs[1] + 1));
  // Each further tier should cost dramatically more than the last.
  for (let tier = 2; tier <= 5; tier++) {
    assert.ok(tierOneCost(pack, "fire-dragon", tier) > tierOneCost(pack, "fire-dragon", tier - 1) * 2);
  }
});

check("a tier can only be built from the tier below", () => {
  let save = seeded();
  const target = save.dragons[0];
  // Duplicates two tiers down are not eligible fodder for a tier 2 target.
  const t2 = { ...createDragon(pack, target.speciesId, { now: NOW }), tier: 2 };
  const t1s = [0, 1, 2, 3].map(() => createDragon(pack, target.speciesId, { now: NOW }));
  save = { ...save, dragons: [t2, ...t1s], roostCapacity: 20 };
  const wrong = merge(pack, save, t2.id);
  assert.ok(!wrong.ok, "tier 1 duplicates should not raise a tier 2 dragon");
});

check("capacity outruns production as a dragon is raised", () => {
  const base = make("fire-dragon");
  const levelled = { ...base, level: 20 };
  const tiered = { ...base, tier: 3 };
  assert.ok(hoursToFill(pack, levelled) > hoursToFill(pack, base));
  assert.ok(hoursToFill(pack, tiered) > hoursToFill(pack, base));
  // Both still earn more per hour than they did.
  assert.ok(coinsPerHour(pack, levelled) > coinsPerHour(pack, base));
  assert.ok(coinsPerHour(pack, tiered) > coinsPerHour(pack, base));
});

check("a merge raises the cap faster than the output", () => {
  const t1 = make("fire-dragon");
  const t2 = { ...t1, tier: 2 };
  const capRatio = coinCap(pack, t2) / coinCap(pack, t1);
  const rateRatio = coinsPerHour(pack, t2) / coinsPerHour(pack, t1);
  assert.ok(capRatio > rateRatio, `cap ${capRatio} vs rate ${rateRatio}`);
});

console.log("\nIndividual value");
check("the roll stays inside 0-31", () => {
  for (let i = 0; i < 2000; i++) {
    const d = createDragon(pack, "fire-dragon", { now: NOW });
    assert.ok(Number.isInteger(d.iv), `iv is not an integer: ${d.iv}`);
    assert.ok(d.iv >= IV_MIN && d.iv <= IV_MAX, `iv out of range: ${d.iv}`);
  }
});

check("both ends of the range are reachable", () => {
  assert.strictEqual(createDragon(pack, "fire-dragon", { rng: () => 0 }).iv, IV_MIN);
  assert.strictEqual(
    createDragon(pack, "fire-dragon", { rng: () => 0.9999 }).iv,
    IV_MAX,
  );
});

check("a perfect roll pays its full magnitude", () => {
  const worst = make("fire-dragon", IV_MIN);
  const best = make("fire-dragon", IV_MAX);
  assert.strictEqual(ivBonus(pack, worst, "production"), 0);
  assert.ok(
    Math.abs(ivBonus(pack, best, "production") - pack.iv.productionMagnitude) < 1e-9,
  );
  const ratio = coinsPerHour(pack, best) / coinsPerHour(pack, worst);
  assert.ok(Math.abs(ratio - (1 + pack.iv.productionMagnitude)) < 0.02);
});

check("the curve makes the low end nearly worthless", () => {
  const gapLow =
    ivBonus(pack, make("fire-dragon", 4), "production") -
    ivBonus(pack, make("fire-dragon", 0), "production");
  const gapHigh =
    ivBonus(pack, make("fire-dragon", 31), "production") -
    ivBonus(pack, make("fire-dragon", 30), "production");
  // A four-point gap at the bottom must matter less than a one-point gap at the top.
  assert.ok(gapHigh > gapLow, `low ${gapLow} vs high ${gapHigh}`);
  assert.ok(ivBonus(pack, make("fire-dragon", 4), "production") < 0.01);
});

check("a straight curve restores a proportional payout", () => {
  const linear = { ...pack, iv: { ...pack.iv, curveExponent: 1 } };
  const mid = make("fire-dragon", 16);
  const expected = linear.iv.productionMagnitude * (16 / IV_MAX);
  assert.ok(Math.abs(ivBonus(linear, mid, "production") - expected) < 1e-9);
});

check("disadvantage skews rolls low without shrinking the range", () => {
  const rolls: number[] = [];
  for (let i = 0; i < 20000; i++) rolls.push(rollIv(pack));
  const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
  // Two d32 keeping the worse averages about 10, against 15.5 for a single roll.
  assert.ok(mean < 12, `mean was ${mean}`);
  assert.ok(rolls.includes(IV_MAX), "31 should still be reachable");
  assert.ok(rolls.includes(IV_MIN));
  const perfect = rolls.filter((r) => r === IV_MAX).length / rolls.length;
  assert.ok(perfect < 1 / 31, "a perfect roll should be rarer than flat odds");
});

check("disadvantage can be switched off", () => {
  const flat = { ...pack, iv: { ...pack.iv, disadvantage: false } };
  const rolls: number[] = [];
  for (let i = 0; i < 20000; i++) rolls.push(rollIv(flat));
  const mean = rolls.reduce((a, b) => a + b, 0) / rolls.length;
  assert.ok(Math.abs(mean - IV_MAX / 2) < 1, `mean was ${mean}`);
});

check("growth magnitude is honoured when set", () => {
  const tuned = { ...pack, iv: { ...pack.iv, growthMagnitude: 0.5 } };
  const worst = make("fire-dragon", IV_MIN);
  const best = make("fire-dragon", IV_MAX);
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
  const d = make("fire-dragon", 12);
  assert.strictEqual(grantXp(pack, d, 5000).dragon.iv, 12);
});

check("ivs do not pass down from parents", () => {
  const save = seeded();
  const perfect = save.dragons.map((d) => ({ ...d, iv: IV_MAX }));
  const flawless = { ...save, dragons: perfect, roostCapacity: 9 };
  let allPerfect = true;
  for (let i = 0; i < 60; i++) {
    const bred = startBreeding(pack, flawless, perfect[0].id, perfect[1].id, NOW);
    const hatched = claimHatchling(pack, bred.save, LATER);
    const child = hatched.save.dragons[hatched.save.dragons.length - 1];
    if (child.iv !== IV_MAX) allPerfect = false;
  }
  assert.ok(!allPerfect, "hatchlings appear to inherit parent IVs");
});

check("a dragon whose species was deleted is dropped on load", () => {
  const save = seeded();
  const ghost = { ...save.dragons[0], id: "ghost", speciesId: "deleted-dragon" };
  const stale = {
    ...save,
    dragons: [...save.dragons, ghost],
    discovered: [...save.discovered, "deleted-dragon"],
  };
  const fixed = migrateSave(pack, stale);
  assert.ok(!fixed.dragons.some((d) => d.id === "ghost"));
  assert.ok(!fixed.discovered.includes("deleted-dragon"));
  // Everything real survives.
  assert.strictEqual(fixed.dragons.length, save.dragons.length);
});

check("an egg of a deleted dragon is cleared", () => {
  const save = seeded();
  const [a, b] = save.dragons;
  const withEgg = {
    ...save,
    breeding: {
      id: "nest_test",
      parentA: a.id,
      parentB: b.id,
      startedAt: NOW,
      readyAt: NOW + 1000,
      resultSpeciesId: "deleted-dragon",
    },
  };
  assert.deepStrictEqual(migrateSave(pack, withEgg).nests, []);
});

check("an egg whose parents were dropped is cleared", () => {
  const save = seeded();
  const ghost = { ...save.dragons[0], id: "ghost", speciesId: "deleted-dragon" };
  const withEgg = {
    ...save,
    dragons: [...save.dragons, ghost],
    breeding: {
      id: "nest_test",
      parentA: "ghost",
      parentB: save.dragons[1].id,
      startedAt: NOW,
      readyAt: NOW + 1000,
      resultSpeciesId: "fire-dragon",
    },
  };
  assert.deepStrictEqual(migrateSave(pack, withEgg).nests, []);
});

check("a real egg survives migration", () => {
  const save = seeded();
  const [a, b] = save.dragons;
  const withEgg = {
    ...save,
    breeding: {
      id: "nest_test",
      parentA: a.id,
      parentB: b.id,
      startedAt: NOW,
      readyAt: NOW + 1000,
      resultSpeciesId: "fire-dragon",
    },
  };
  assert.strictEqual(migrateSave(pack, withEgg).nests?.length, 1);
});

check("older saves are repaired rather than dropped", () => {
  const save = seeded();
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
check("the incubation ladder runs from thirty minutes upward", () => {
  // Fire is the floor and everything else sits above it, in order of what it
  // earns. The whole ladder is scaled together, so the shape survives retuning.
  assert.strictEqual(incubationSeconds(pack, "fire-dragon"), 1800);

  const byOutput = Object.values(pack.species)
    .filter((s) => s.incubationSeconds)
    .sort((a, b) => a.baseProduction - b.baseProduction);
  for (const s of byOutput)
    assert.ok(
      incubationSeconds(pack, s.id) >= 1800,
      `${s.name} hatches faster than a Fire Dragon`,
    );
});

check("each dragon can set its own incubation", () => {
  assert.strictEqual(incubationSeconds(pack, "fire-dragon"), 1800);
  assert.strictEqual(incubationSeconds(pack, "monster-dragon"), 108000);
  assert.ok(
    incubationSeconds(pack, "air-dragon") > incubationSeconds(pack, "water-dragon"),
  );
});

check("a dragon with no time set falls back to the default", () => {
  const stripped = {
    ...pack,
    species: {
      ...pack.species,
      "fire-dragon": { ...pack.species["fire-dragon"], incubationSeconds: undefined },
    },
  };
  assert.strictEqual(
    incubationSeconds(stripped, "fire-dragon"),
    pack.balance.defaultIncubationSeconds,
  );
});

check("the egg timer matches the dragon inside it", () => {
  const save = { ...seeded(), roostCapacity: 9 };
  const [a, b] = save.dragons;
  const nest = nestsOf(startBreeding(pack, save, a.id, b.id, NOW, () => 0.1).save)[0];
  assert.strictEqual(
    nest.readyAt - nest.startedAt,
    incubationSeconds(pack, nest.resultSpeciesId) * 1000,
  );
});

check("an egg cannot be hatched early", () => {
  const save = { ...seeded(), roostCapacity: 9 };
  const [a, b] = save.dragons;
  const bred = startBreeding(pack, save, a.id, b.id, NOW, () => 0.1);
  const early = claimHatchling(pack, bred.save, NOW + 1000);
  assert.ok(!early.ok);
  assert.match(early.message, /not hatched/);
});

console.log("\nCosts");
check("perches grow polynomially", () => {
  const start = pack.balance.roostCapacity;
  const costs = Array.from({ length: 8 }, (_, i) => nextRoostSlotCost(pack, start + i));
  // Always rising.
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] > costs[i - 1]);
  // The multiple between successive perches falls away — that is what makes it
  // polynomial rather than exponential.
  const ratios = costs.slice(1).map((c, i) => c / costs[i]);
  for (let i = 1; i < ratios.length; i++)
    assert.ok(ratios[i] < ratios[i - 1], `ratio rose at step ${i}`);
  // The nth perch costs base × n ^ exponent.
  const { roostSlotCost, roostSlotCostExponent } = pack.balance;
  assert.strictEqual(costs[0], roostSlotCost);
  assert.strictEqual(
    costs[3],
    Math.round(roostSlotCost * Math.pow(4, roostSlotCostExponent)),
  );
});

check("the first oven is cheap, then the ladder resumes", () => {
  const costs = Array.from({ length: 5 }, (_, i) => nextBakeryCost(pack, i));
  assert.strictEqual(costs[0], pack.balance.firstBakeryCost);
  assert.strictEqual(costs[1], pack.balance.bakeryCost);
  // From the second onwards it is a constant multiple, which is what perches
  // deliberately are not.
  const growth = pack.balance.bakeryCostGrowth;
  for (let i = 2; i < costs.length; i++)
    assert.ok(Math.abs(costs[i] / costs[i - 1] - growth) < 0.01, `step ${i}`);
});

check("a new keeper can afford an oven before earning anything", () => {
  // Spend everything on the first dragon, then still be able to make food.
  const save = newGame(pack, NOW);
  const bought = applyAction(pack, save, { type: "buySpecies", speciesId: "fire-dragon" }, ctx());
  assert.strictEqual(bought.save.coins, 0);
  const oven = nextBakeryCost(pack, 0);
  const rate = coinsPerHour(pack, bought.save.dragons[0]);
  // Within the hour, rather than a day.
  assert.ok((oven / rate) * 60 < 60, `takes ${((oven / rate) * 60).toFixed(0)} minutes`);
});

check("bakeries outrun perches given enough of each", () => {
  const start = pack.balance.roostCapacity;
  assert.ok(nextBakeryCost(pack, 6) > nextRoostSlotCost(pack, start + 6));
});

console.log("\nBakeries");
check("an oven starts idle and takes an order", () => {
  const save = { ...seeded(), coins: 10000 };
  const built = buildBakery(pack, save, NOW);
  assert.ok(built.ok, built.message);
  const oven = built.save.bakeries[0];
  assert.strictEqual(ovenState(oven, NOW), "idle");
  const started = startBatch(pack, built.save, oven.id, "batch-2", NOW);
  assert.ok(started.ok, started.message);
  assert.strictEqual(ovenState(started.save.bakeries[0], NOW), "baking");
});

check("the cheapest order is free", () => {
  const save = { ...seeded(), coins: 0 };
  const built = buildBakery(pack, { ...save, coins: 10000 }, NOW);
  const broke = { ...built.save, coins: 0 };
  const started = startBatch(pack, broke, broke.bakeries[0].id, "batch-1", NOW);
  assert.ok(started.ok, started.message);
});

check("bigger orders cost more, take longer and pay better", () => {
  const batches = pack.balance.foodBatches;
  for (let i = 1; i < batches.length; i++) {
    assert.ok(batches[i].coinCost > batches[i - 1].coinCost);
    assert.ok(batches[i].seconds > batches[i - 1].seconds);
    assert.ok(batches[i].food > batches[i - 1].food);
    const rate = (b: (typeof batches)[number]) => b.food / b.seconds;
    assert.ok(rate(batches[i]) > rate(batches[i - 1]), "later orders should pay better per minute");
  }
});

check("an order cannot be collected early, and pays out once done", () => {
  const built = buildBakery(pack, { ...seeded(), coins: 10000 }, NOW);
  const oven = built.save.bakeries[0];
  const started = startBatch(pack, built.save, oven.id, "batch-1", NOW);
  const early = collectBatch(pack, started.save, oven.id, NOW + 1000);
  assert.ok(!early.ok);
  const batch = pack.balance.foodBatches[0];
  const done = collectBatch(pack, started.save, oven.id, NOW + batch.seconds * 1000);
  assert.ok(done.ok, done.message);
  assert.strictEqual(done.save.food - started.save.food, batch.food);
  assert.strictEqual(done.save.bakeries[0].batchId, null);
});

check("a busy oven refuses a second order", () => {
  const built = buildBakery(pack, { ...seeded(), coins: 10000 }, NOW);
  const oven = built.save.bakeries[0];
  const started = startBatch(pack, built.save, oven.id, "batch-2", NOW);
  const again = startBatch(pack, started.save, oven.id, "batch-1", NOW + 1000);
  assert.ok(!again.ok);
});

console.log("\nSoftlock guard");
check("a keeper with no dragons can always afford one", () => {
  const cheapest = Math.min(
    ...Object.values(pack.species)
      .filter((s) => s.marketPrice)
      .map((s) => s.marketPrice as number),
  );
  const broke = { ...newGame(pack, NOW), coins: 0 };
  const fixed = ensureViable(pack, broke);
  assert.strictEqual(fixed.coins, cheapest);

  // And it works through the dispatcher, not just when called directly.
  const acted = applyAction(pack, broke, { type: "collectCoins" }, ctx());
  assert.ok(acted.save.coins >= cheapest);
});

check("releasing the last dragon leaves a way back", () => {
  const save = { ...seeded(["fire-dragon"]), coins: 0 };
  const released = applyAction(pack, save, { type: "releaseDragon", dragonId: save.dragons[0].id }, ctx());
  // Releasing your only dragon is refused outright, so this cannot strand you.
  assert.ok(!released.ok);
});

check("the guard leaves a going concern alone", () => {
  const save = { ...seeded(), coins: 3 };
  assert.strictEqual(ensureViable(pack, save).coins, 3);
});

check("an egg in the nest counts as a way forward", () => {
  const save = seeded();
  const [a, b] = save.dragons;
  const bred = applyAction(pack, save, { type: "breed", parentA: a.id, parentB: b.id }, ctx());
  const empty = { ...bred.save, dragons: [], coins: 0 };
  assert.strictEqual(ensureViable(pack, empty).coins, 0, "an egg is already a way out");
});

check("branches with something found sort above the rest", () => {
  const save = { ...newGame(pack, NOW), discovered: ["fire-dragon"] };
  const shown = redactPack(pack, save, false);
  // The Codex sorts on whether a count was sent, not on whether a name was —
  // Earth carries a name because its dragon is for sale, but nothing there has
  // been found, so it belongs with the unknowns.
  const found = (id: string) => (shown.branchTotals[id] === undefined ? 1 : 0);
  const walk = (parentId: string | null) => {
    const kids = Object.values(shown.taxa)
      .filter((x) => x.parentId === parentId)
      .sort((a, b) => found(a.id) - found(b.id) || a.name.localeCompare(b.name));
    const flags = kids.map((k) => found(k.id));
    const firstUnknown = flags.indexOf(1);
    if (firstUnknown >= 0)
      assert.ok(
        flags.slice(firstUnknown).every((f) => f === 1),
        "a found branch sorted below an unfound one",
      );
    for (const kid of kids) walk(kid.id);
  };
  walk(null);

  // Concretely: under Base Elements, Fire comes before Earth.
  const base = Object.values(shown.taxa).filter((x) => x.parentId === "base-elements");
  assert.strictEqual(found("fire"), 0);
  assert.strictEqual(found("earth"), 1, "Earth is named but unfound");
  assert.ok(base.length >= 2);
});

console.log("\nBreeding log");
check("a hatch is recorded against the pairing", () => {
  const save = { ...seeded(), roostCapacity: 9 };
  const [a, b] = save.dragons;
  const bred = applyAction(pack, save, { type: "breed", parentA: a.id, parentB: b.id }, ctx());
  const hatched = applyAction(pack, bred.save, { type: "hatch" }, { ...ctx(), now: LATER });
  assert.ok(hatched.ok, hatched.message);

  const key = pairKey(a.speciesId, b.speciesId);
  const row = hatched.save.breedingLog?.[key];
  assert.ok(row, "nothing was written to the log");
  assert.strictEqual(Object.values(row!).reduce((n, c) => n + c, 0), 1);
});

check("the log key does not care about parent order", () => {
  assert.strictEqual(pairKey("fire-dragon", "water-dragon"), pairKey("water-dragon", "fire-dragon"));
});

check("repeat hatches accumulate", () => {
  let save = { ...seeded(), roostCapacity: 20 };
  const [a, b] = save.dragons;
  for (let i = 0; i < 5; i++) {
    save = applyAction(pack, save, { type: "breed", parentA: a.id, parentB: b.id }, { ...ctx(), rng: () => i / 5 }).save;
    save = applyAction(pack, save, { type: "hatch" }, { ...ctx(), now: LATER }).save;
  }
  const row = save.breedingLog![pairKey(a.speciesId, b.speciesId)];
  assert.strictEqual(Object.values(row).reduce((n, c) => n + c, 0), 5);
});

console.log("\nNests");
check("one nest to start, and it can only hold one egg", () => {
  const save = { ...seeded(["fire-dragon", "earth-dragon", "water-dragon"]), roostCapacity: 9 };
  assert.strictEqual(nestCapacityOf(pack, save), 1);
  const [a, b, c] = save.dragons;
  const first = applyAction(pack, save, { type: "breed", parentA: a.id, parentB: b.id }, ctx());
  assert.ok(first.ok, first.message);
  const second = applyAction(pack, first.save, { type: "breed", parentA: b.id, parentB: c.id }, ctx());
  assert.ok(!second.ok);
  assert.match(second.message, /nest/);
});

check("a bought nest lets a second egg sit", () => {
  const save = {
    ...seeded(["fire-dragon", "earth-dragon", "water-dragon", "air-dragon"]),
    roostCapacity: 9,
    coins: 10_000_000,
  };
  const bought = applyAction(pack, save, { type: "buyNest" }, ctx());
  assert.ok(bought.ok, bought.message);
  assert.strictEqual(nestCapacityOf(pack, bought.save), 2);
  assert.strictEqual(save.coins - bought.save.coins, nextNestCost(pack, 1));

  const [a, b, c, d] = bought.save.dragons;
  const one = applyAction(pack, bought.save, { type: "breed", parentA: a.id, parentB: b.id }, ctx());
  const two = applyAction(pack, one.save, { type: "breed", parentA: c.id, parentB: d.id }, ctx());
  assert.ok(two.ok, two.message);
  assert.strictEqual(nestsOf(two.save).length, 2);
});

check("nests get dearer each time", () => {
  const costs = [1, 2, 3].map((owned) => nextNestCost(pack, owned));
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] > costs[i - 1]);
  assert.strictEqual(costs[0], pack.balance.nestCost);
});

check("a dragon cannot sit on two eggs at once", () => {
  const save = {
    ...seeded(["fire-dragon", "earth-dragon", "water-dragon"]),
    roostCapacity: 9,
    coins: 10_000_000,
  };
  const bought = applyAction(pack, save, { type: "buyNest" }, ctx());
  const [a, b, c] = bought.save.dragons;
  const one = applyAction(pack, bought.save, { type: "breed", parentA: a.id, parentB: b.id }, ctx());
  const reuse = applyAction(pack, one.save, { type: "breed", parentA: a.id, parentB: c.id }, ctx());
  assert.ok(!reuse.ok, "a parent was reused while sitting");
});

check("hatching names the nest it empties", () => {
  const save = {
    ...seeded(["fire-dragon", "earth-dragon", "water-dragon", "air-dragon"]),
    roostCapacity: 9,
    coins: 10_000_000,
  };
  const bought = applyAction(pack, save, { type: "buyNest" }, ctx());
  const [a, b, c, d] = bought.save.dragons;
  let current = applyAction(pack, bought.save, { type: "breed", parentA: a.id, parentB: b.id }, ctx()).save;
  current = applyAction(pack, current, { type: "breed", parentA: c.id, parentB: d.id }, ctx()).save;

  const second = nestsOf(current)[1];
  const hatched = applyAction(pack, current, { type: "hatch", nestId: second.id }, { ...ctx(), now: LATER });
  assert.ok(hatched.ok, hatched.message);
  const left = nestsOf(hatched.save);
  assert.strictEqual(left.length, 1);
  assert.notStrictEqual(left[0].id, second.id);
});

check("an old single-slot save becomes a nest", () => {
  const save = seeded();
  const [a, b] = save.dragons;
  const legacy = {
    ...save,
    nests: undefined,
    breeding: {
      id: "nest_1",
      parentA: a.id,
      parentB: b.id,
      startedAt: NOW,
      readyAt: NOW + 1000,
      resultSpeciesId: "fire-dragon",
    },
  };
  const migrated = migrateSave(pack, legacy);
  assert.strictEqual(migrated.nests?.length, 1);
  assert.strictEqual(migrated.breeding, null);
});

console.log("\nMarket limits");
check("a dragon can be bought twice a day", () => {
  const save = { ...newGame(pack, NOW), coins: 1_000_000 };
  const first = applyAction(pack, save, { type: "buySpecies", speciesId: "fire-dragon" }, ctx());
  assert.ok(first.ok, first.message);

  const again = applyAction(pack, first.save, { type: "buySpecies", speciesId: "fire-dragon" }, ctx());
  assert.ok(!again.ok, "bought twice in a day");
  assert.match(again.message, /today/);
});

check("the limit is per dragon, not per shop", () => {
  const save = { ...newGame(pack, NOW), coins: 1_000_000 };
  const bought = applyAction(pack, save, { type: "buySpecies", speciesId: "fire-dragon" }, ctx());
  const other = applyAction(pack, bought.save, { type: "buySpecies", speciesId: "earth-dragon" }, ctx());
  assert.ok(other.ok, other.message);
});

check("the shelf refills after the cooldown", () => {
  const save = { ...newGame(pack, NOW), coins: 1_000_000 };
  const bought = applyAction(pack, save, { type: "buySpecies", speciesId: "fire-dragon" }, ctx());
  const later = NOW + pack.balance.marketCooldownSeconds * 1000 + 1;
  assert.strictEqual(marketCooldownLeft(pack, bought.save, "fire-dragon", later), 0);
  const again = applyAction(pack, bought.save, { type: "buySpecies", speciesId: "fire-dragon" }, { ...ctx(), now: later });
  assert.ok(again.ok, again.message);
});

check("a designer is not held to it", () => {
  const save = { ...newGame(pack, NOW), adminMode: true, coins: 0 };
  let current = save;
  for (let i = 0; i < 3; i++) {
    const r = applyAction(pack, current, { type: "buySpecies", speciesId: "fire-dragon" }, ctx(true));
    assert.ok(r.ok, r.message);
    current = r.save;
  }
});

console.log("\nLeaderboard names");
check("a name is trimmed rather than trusted", () => {
  assert.strictEqual(cleanName("  Keeper of Ash  "), "Keeper of Ash");
  assert.strictEqual(cleanName("many     spaces"), "many spaces");
  assert.strictEqual(cleanName("x".repeat(200))!.length, NAME_MAX);
});

check("a name that is only whitespace or control codes falls back to anonymous", () => {
  for (const raw of ["", "   ", "\u0000\u0001", "\n\t "])
    assert.strictEqual(cleanName(raw), null, JSON.stringify(raw));
});

check("control characters are stripped from a real name", () => {
  const cleaned = cleanName("Ash\u0000burn\u001f");
  assert.strictEqual(cleaned, "Ashburn");
});

console.log("\nRedaction");
check("an unknown dragon is not sent to the client", () => {
  const save = seeded();
  const shown = redactPack(pack, save, false);
  // Starters and anything on sale are visible; nothing else is.
  for (const id of ["life-dragon", "monster-dragon", "perfection-dragon", "ether-dragon"])
    assert.ok(!shown.species[id], `${id} leaked`);
  for (const id of save.discovered) assert.ok(shown.species[id], `${id} should be visible`);
});

check("the shop stays visible", () => {
  const shown = redactPack(pack, seeded(), false);
  for (const s of Object.values(pack.species))
    if (s.marketPrice) assert.ok(shown.species[s.id], `${s.name} vanished from the market`);
});

check("no breeding rule ever reaches an ordinary player", () => {
  for (const save of [null, seeded()]) {
    const shown = redactPack(pack, save, false);
    assert.deepStrictEqual(shown.breedingRules, []);
    assert.deepStrictEqual(shown.balance.startingSpecies, []);
  }
});

check("the shape of the tree is sent, the names are not", () => {
  const shown = redactPack(pack, newGame(pack, NOW), false);
  // Same number of branches as the real tree — a player can see there is more.
  assert.strictEqual(Object.keys(shown.taxa).length, Object.keys(pack.taxa).length);

  // But nothing they have not unlocked is named, in the payload or the ids.
  const realNames = new Set(Object.values(pack.taxa).map((x) => x.name));
  for (const [id, taxon] of Object.entries(shown.taxa)) {
    if (id.startsWith("unknown-")) {
      assert.strictEqual(taxon.name, "", `${id} carries a name`);
      assert.strictEqual(taxon.description, "");
      assert.ok(!realNames.has(taxon.name));
    }
  }
  for (const hidden of ["transcendent", "duality", "physical", "special", "life", "hybrid"])
    assert.ok(!shown.taxa[hidden], `${hidden} kept its id`);
});

check("counts are real where they are given at all", () => {
  const save = { ...newGame(pack, NOW), discovered: ["fire-dragon"] };
  const shown = redactPack(pack, save, false);
  const rootId = Object.values(shown.taxa).find((x) => x.parentId === null)!.id;
  // The root covers every dragon in the game, not just the visible ones.
  assert.strictEqual(shown.branchTotals[rootId], Object.keys(pack.species).length);
  assert.strictEqual(shown.branchTotals["fire"], 2, "Fire holds two dragons");
});

check("a branch with nothing found is not counted at all", () => {
  const save = { ...newGame(pack, NOW), discovered: ["fire-dragon"] };
  const shown = redactPack(pack, save, false);

  // Not zero, not omitted from the tree — simply never mentioned.
  for (const id of ["earth", "water"])
    assert.strictEqual(shown.branchTotals[id], undefined, `${id} leaked a count`);
  for (const [id, taxon] of Object.entries(shown.taxa))
    if (!taxon.name)
      assert.strictEqual(shown.branchTotals[id], undefined, `${id} leaked a count`);

  // Nothing at all is sent for a keeper who has found nothing.
  const fresh = redactPack(pack, newGame(pack, NOW), false);
  assert.deepStrictEqual(fresh.branchTotals, {});
});

check("finding something reveals its branch counts and no others", () => {
  const save = { ...newGame(pack, NOW), discovered: ["fire-dragon", "perfection-dragon"] };
  const shown = redactPack(pack, save, false);
  assert.ok(shown.branchTotals["duality"] > 0, "the branch it sits in should count");
  assert.ok(shown.branchTotals["transcendent"] > 0, "and the branch above");
  assert.strictEqual(shown.branchTotals["physical"], undefined, "but not a sibling");
});

check("an anonymous branch has nothing in it to count", () => {
  const shown = redactPack(pack, newGame(pack, NOW), false);
  for (const [id] of Object.entries(shown.taxa)) {
    if (!id.startsWith("unknown-")) continue;
    const inside = Object.values(shown.species).filter((s) => s.taxonId === id);
    assert.deepStrictEqual(inside, [], `${id} leaked its contents`);
  }
});

check("placeholder ids are stable between requests", () => {
  const save = newGame(pack, NOW);
  const a = redactPack(pack, save, false);
  const b = redactPack(pack, save, false);
  assert.deepStrictEqual(Object.keys(a.taxa).sort(), Object.keys(b.taxa).sort());
});

check("undiscovered branches are withheld", () => {
  const shown = redactPack(pack, seeded(), false);
  for (const id of ["transcendent", "duality", "physical", "special", "life"])
    assert.ok(!shown.taxa[id], `${id} leaked`);
  // What is left is a valid tree: every parent that survives is present.
  for (const taxon of Object.values(shown.taxa))
    if (taxon.parentId) assert.ok(shown.taxa[taxon.parentId], `${taxon.name} is orphaned`);
});

check("discovering a dragon reveals its branch and nothing more", () => {
  const save = seeded();
  const found = { ...save, discovered: [...save.discovered, "perfection-dragon"] };
  const shown = redactPack(pack, found, false);
  assert.ok(shown.species["perfection-dragon"]);
  assert.ok(shown.taxa["duality"], "its own branch should appear");
  assert.ok(shown.taxa["transcendent"], "and the branch above it");
  assert.ok(!shown.taxa["physical"], "but not a sibling branch");
  assert.ok(!shown.species["ether-dragon"], "nor a neighbour dragon");
});

check("a designer sees everything", () => {
  const shown = redactPack(pack, seeded(), true);
  assert.strictEqual(Object.keys(shown.species).length, Object.keys(pack.species).length);
  assert.strictEqual(shown.breedingRules.length, pack.breedingRules.length);
  assert.ok(shown.complete);
});

check("progress can still be counted without naming anything", () => {
  const shown = redactPack(pack, seeded(), false);
  assert.strictEqual(shown.totalSpecies, Object.keys(pack.species).length);
});

console.log("\nAction dispatcher");
check("actions run through one dispatcher", () => {
  const save = { ...seeded(), food: 500 };
  const fed = applyAction(pack, save, { type: "feed", dragonId: save.dragons[0].id, amount: 50 }, ctx());
  assert.ok(fed.ok, fed.message);
  assert.strictEqual(fed.save.food, 450);
});

check("an illegal action is refused and changes nothing", () => {
  const save = { ...seeded(), food: 0, coins: 0 };
  for (const action of [
    { type: "feed" as const, dragonId: save.dragons[0].id, amount: 100 },
    { type: "buySpecies" as const, speciesId: "fire-dragon" },
    { type: "buyRoostSlot" as const },
    { type: "buildBakery" as const },
  ]) {
    const r = applyAction(pack, save, action, ctx());
    assert.ok(!r.ok, `${action.type} should have been refused`);
    assert.strictEqual(r.save, save, `${action.type} altered the save`);
  }
});

check("designer actions are refused without admin", () => {
  const save = seeded();
  for (const action of [
    { type: "setAdminMode" as const, on: true },
    { type: "grantDragon" as const, speciesId: "ether-dragon" },
    { type: "addPerches" as const, count: 50 },
    { type: "revealCodex" as const },
    { type: "skipIncubation" as const },
  ]) {
    const denied = applyAction(pack, save, action, ctx(false));
    assert.ok(!denied.ok, `${action.type} was allowed`);
    assert.strictEqual(denied.save.dragons.length, save.dragons.length);
    assert.strictEqual(denied.save.adminMode, false);
  }
  // The same actions succeed for a designer.
  const granted = applyAction(pack, save, { type: "revealCodex" }, ctx(true));
  assert.ok(granted.ok);
});

check("a stale admin flag is ignored for a non-designer", () => {
  // A save carrying adminMode from an account that had it, now in the hands of
  // one that does not.
  const stale = { ...seeded(), adminMode: true, coins: 0, food: 0 };

  const bought = applyAction(pack, stale, { type: "buySpecies", speciesId: "fire-dragon" }, ctx(false));
  assert.ok(!bought.ok, "free purchase went through on a stale flag");
  assert.strictEqual(bought.save.adminMode, false, "the flag should be cleared");

  // And the clearing sticks, rather than being recomputed each time.
  const again = applyAction(pack, bought.save, { type: "collectCoins" }, ctx(false));
  assert.strictEqual(again.save.adminMode, false);

  // A designer keeps it.
  const kept = applyAction(pack, stale, { type: "collectCoins" }, ctx(true));
  assert.strictEqual(kept.save.adminMode, true);
});

check("a stale flag cannot skip timers or spend nothing", () => {
  const stale = { ...seeded(), adminMode: true, coins: 0 };
  const bought = applyAction(pack, stale, { type: "buySpecies", speciesId: "fire-dragon" }, ctx(false));
  assert.ok(!bought.ok, "a stale flag paid for a dragon");

  const [a, b] = stale.dragons;
  const withEgg = {
    ...stale,
    roostCapacity: 9,
    breeding: {
      id: "nest_test",
      parentA: a.id,
      parentB: b.id,
      startedAt: NOW,
      readyAt: NOW + 3_600_000,
      resultSpeciesId: "fire-dragon",
    },
  };
  const early = applyAction(pack, withEgg, { type: "hatch" }, ctx(false));
  assert.ok(!early.ok, "the egg was not ready");
});

check("free text is capped", () => {
  const save = seeded();
  const id = save.dragons[0].id;
  const long = "x".repeat(5000);
  const named = applyAction(pack, save, { type: "renameDragon", dragonId: id, nickname: long }, ctx());
  assert.ok(named.save.dragons[0].nickname!.length <= 40);
  const noted = applyAction(pack, save, { type: "noteDragon", dragonId: id, notes: long }, ctx());
  assert.ok(noted.save.dragons[0].notes.length <= 500);
});

check("perches cannot be granted without bound", () => {
  const save = seeded();
  const r = applyAction(pack, save, { type: "addPerches", count: 99999 }, ctx(true));
  assert.ok(r.save.roostCapacity - save.roostCapacity <= 100);
});

console.log("\nAdmin access");
check("guests are refused admin, owners are not", () => {
  // canUseAdmin reads cloudEnabled, which is false without Supabase keys — that
  // is the local-development case, where Admin is meant to be open. The account
  // rules themselves are asserted here against the same predicate the app uses.
  const guest = { id: "g", email: null, isGuest: true, providers: [] };
  const owner = { id: "o", email: "me@example.com", isGuest: false, providers: ["email"] };
  const decide = (acct: typeof guest | typeof owner | null, cloud: boolean) => {
    if (!cloud) return true;
    if (!acct) return false;
    if (acct.isGuest) return false;
    return Boolean(acct.email);
  };
  assert.strictEqual(decide(guest, true), false);
  assert.strictEqual(decide(null, true), false);
  assert.strictEqual(decide(owner, true), true);
  assert.strictEqual(decide(guest, false), true, "local play keeps Admin");
});

check("admin mode costs nothing only while it is on", () => {
  const on = { ...seeded(), adminMode: true, coins: 0 };
  assert.ok(buySpecies(pack, on, "fire-dragon", NOW).ok);
  const off = { ...on, adminMode: false };
  assert.ok(!buySpecies(pack, off, "fire-dragon", NOW).ok);
});

console.log("\nAdmin mode");
check("nothing is spent while admin mode is on", () => {
  const save = { ...seeded(), adminMode: true, coins: 0, food: 0 };
  const built = buildBakery(pack, save, NOW);
  assert.ok(built.ok, built.message);
  assert.strictEqual(built.save.coins, 0);
  const bought = buySpecies(pack, built.save, "fire-dragon", NOW);
  assert.ok(bought.ok, bought.message);
  assert.strictEqual(bought.save.coins, 0);
  const fed = feed(pack, bought.save, bought.save.dragons[0].id, 500);
  assert.ok(fed.ok, fed.message);
  assert.strictEqual(fed.save.food, 0);
});

check("the roost never fills in admin mode", () => {
  const save = { ...seeded(), adminMode: true, roostCapacity: 1 };
  const bought = buySpecies(pack, save, "fire-dragon", NOW);
  assert.ok(bought.ok, bought.message);
});

check("admin mode can skip an egg", () => {
  const save = { ...seeded(), adminMode: true };
  const [a, b] = save.dragons;
  const bred = startBreeding(pack, save, a.id, b.id, NOW, () => 0.1);
  const hatched = claimHatchling(pack, bred.save, NOW, () => 0.5);
  assert.ok(hatched.ok, hatched.message);
});

check("costs apply again once admin mode is off", () => {
  const save = { ...seeded(), adminMode: true, coins: 100 };
  const off = setAdminMode(save, false).save;
  assert.strictEqual(off.coins, 100);
  const bought = buySpecies(pack, off, "fire-dragon", NOW);
  assert.ok(!bought.ok);
});

console.log("\nActions");
check("an egg cannot be abandoned", () => {
  // The result is decided when the pair nests, so abandoning would have been a
  // free reroll. There is no such action any more.
  const save = { ...seeded(), roostCapacity: 9 };
  const [a, b] = save.dragons;
  const bred = applyAction(pack, save, { type: "breed", parentA: a.id, parentB: b.id }, ctx());
  assert.strictEqual(nestsOf(bred.save).length, 1);
  const attempt = applyAction(
    pack,
    bred.save,
    { type: "cancelBreeding" } as unknown as Parameters<typeof applyAction>[2],
    ctx(true),
  );
  assert.ok(!attempt.ok, "cancelling was still possible");
  assert.strictEqual(nestsOf(attempt.save).length, 1, "the egg survived");
});

check("a new keeper can afford exactly one Fire Dragon", () => {
  const save = newGame(pack, NOW);
  const price = pack.species["fire-dragon"].marketPrice!;
  assert.strictEqual(save.coins, price);

  const bought = applyAction(pack, save, { type: "buySpecies", speciesId: "fire-dragon" }, ctx());
  assert.ok(bought.ok, bought.message);
  assert.strictEqual(bought.save.coins, 0);

  // And not two.
  const again = applyAction(pack, bought.save, { type: "buySpecies", speciesId: "fire-dragon" }, ctx());
  assert.ok(!again.ok);
});

check("a fresh save starts with nothing but coins", () => {
  const save = newGame(pack, NOW);
  assert.deepStrictEqual(save.dragons, []);
  assert.deepStrictEqual(save.discovered, []);
  assert.strictEqual(save.coins, pack.balance.startingCoins);
  assert.strictEqual(save.food, pack.balance.startingFood);
});

check("granting a dragon is the only way to seed one", () => {
  const save = newGame(pack, NOW);
  const denied = applyAction(pack, save, { type: "grantDragon", speciesId: "fire-dragon" }, ctx(false));
  assert.ok(!denied.ok);
});

check("feeding spends food and grants levels", () => {
  const save = seeded();
  const r = feed(pack, { ...save, food: 500 }, save.dragons[0].id, 50);
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.save.food, 450);
  assert.ok(r.save.dragons[0].level > 1);
});

check("feeding without food is refused", () => {
  const save = { ...seeded(), food: 0 };
  const r = feed(pack, save, save.dragons[0].id, 1);
  assert.ok(!r.ok);
  assert.match(r.message, /Not enough food/);
});

check("feeding to the next level lands exactly one level up", () => {
  const save = { ...seeded(), food: 100000 };
  const target = save.dragons[0];
  const needed = foodToNextLevel(pack, target)!;
  const r = feedToNextLevel(pack, save, target.id);
  assert.ok(r.ok, r.message);
  const after = r.save.dragons.find((d) => d.id === target.id)!;
  assert.strictEqual(after.level, target.level + 1);
  assert.strictEqual(save.food - r.save.food, needed);
});

check("short of a level, it feeds everything it can", () => {
  const start = seeded();
  const target = start.dragons[0];
  const needed = foodToNextLevel(pack, target)!;
  const save = { ...start, food: needed - 1 };
  const r = feedToNextLevel(pack, save, target.id);
  assert.ok(r.ok, r.message);
  assert.strictEqual(r.save.food, 0);
  const after = r.save.dragons.find((d) => d.id === target.id)!;
  assert.strictEqual(after.level, target.level);
  assert.ok(after.xp > target.xp);
  assert.match(r.message, /short of the next level/);
});

check("a maxed dragon cannot be fed", () => {
  const start = seeded();
  const maxed = { ...start.dragons[0], level: pack.balance.maxLevel };
  const save = { ...start, food: 1000, dragons: [maxed, start.dragons[1]] };
  assert.strictEqual(foodToNextLevel(pack, maxed), null);
  const r = feedToNextLevel(pack, save, maxed.id);
  assert.ok(!r.ok);
  assert.match(r.message, /max level/);
});

check("a high growth IV makes food go further", () => {
  const tuned = { ...pack, iv: { ...pack.iv, growthMagnitude: 0.5 } };
  const dull = { ...make("fire-dragon"), iv: 0 };
  const sharp = { ...make("fire-dragon"), iv: 31 };
  assert.ok(foodToNextLevel(tuned, sharp)! < foodToNextLevel(tuned, dull)!);
});

check("every bakery order yields a different amount of food", () => {
  const amounts = pack.balance.foodBatches.map((b) => b.food);
  assert.strictEqual(new Set(amounts).size, amounts.length);
});

check("breeding then hatching adds a dragon", () => {
  const save = seeded();
  const [a, b] = save.dragons;
  const bred = startBreeding(pack, save, a.id, b.id, NOW, () => 0.1);
  assert.ok(bred.ok, bred.message);
  const hatched = claimHatchling(pack, bred.save, LATER, () => 0.5);
  assert.ok(hatched.ok, hatched.message);
  assert.strictEqual(hatched.save.dragons.length, 3);
  assert.deepStrictEqual(hatched.save.dragons[2].parentIds, [a.id, b.id]);
});

check("a full roost sends new dragons to storage rather than refusing", () => {
  const save = { ...seeded(), roostCapacity: 2, coins: 100000 };
  assert.strictEqual(perchedCount(save), 2);
  assert.ok(perchesFull(save));

  // Buying still works; the dragon simply lands in storage.
  const bought = applyAction(pack, save, { type: "buySpecies", speciesId: "water-dragon" }, ctx());
  assert.ok(bought.ok, bought.message);
  const arrival = bought.save.dragons[bought.save.dragons.length - 1];
  assert.strictEqual(arrival.stored, true);
  assert.strictEqual(perchedCount(bought.save), 2, "it did not take a perch");
});

check("breeding is never blocked by a full roost", () => {
  const save = { ...seeded(), roostCapacity: 2 };
  const [a, b] = save.dragons;
  const bred = applyAction(pack, save, { type: "breed", parentA: a.id, parentB: b.id }, ctx());
  assert.ok(bred.ok, bred.message);
  const hatched = applyAction(pack, bred.save, { type: "hatch" }, { ...ctx(), now: LATER });
  assert.ok(hatched.ok, hatched.message);
  assert.strictEqual(hatched.save.dragons[hatched.save.dragons.length - 1].stored, true);
});

check("only perched dragons earn", () => {
  const save = seeded();
  const working = save.dragons[0];
  const idle = { ...save.dragons[1], stored: true };
  assert.ok(coinsPerHour(pack, working) > 0);
  assert.strictEqual(coinsPerHour(pack, idle), 0);
  assert.strictEqual(pendingCoins(pack, idle, LATER), idle.uncollectedCoins);
});

check("storage is unlimited", () => {
  // Granted rather than bought, since the market only sells one a day.
  let save = { ...seeded(["fire-dragon"]), roostCapacity: 1 };
  for (let i = 0; i < 25; i++)
    save = applyAction(pack, save, { type: "grantDragon", speciesId: "fire-dragon" }, ctx(true)).save;
  assert.ok(save.dragons.length >= 25);
  assert.strictEqual(perchedCount(save), 1);
});

check("moving between perch and storage", () => {
  const save = { ...seeded(), roostCapacity: 2 };
  const id = save.dragons[0].id;

  const put = applyAction(pack, save, { type: "storeDragon", dragonId: id }, ctx());
  assert.ok(put.ok, put.message);
  assert.strictEqual(put.save.dragons.find((d) => d.id === id)!.stored, true);
  assert.strictEqual(perchedCount(put.save), 1, "it freed a perch");

  const back = applyAction(pack, put.save, { type: "perchDragon", dragonId: id }, ctx());
  assert.ok(back.ok, back.message);
  assert.ok(!back.save.dragons.find((d) => d.id === id)!.stored);
});

check("a dragon cannot be perched when every perch is taken", () => {
  const save = { ...seeded(), roostCapacity: 1 };
  const stored = { ...save.dragons[1], stored: true };
  const full = { ...save, dragons: [save.dragons[0], stored] };
  const r = applyAction(pack, full, { type: "perchDragon", dragonId: stored.id }, ctx());
  assert.ok(!r.ok);
  assert.match(r.message, /perch/);
});

check("merging consumes exactly the required duplicates", () => {
  let save = seeded();
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
  let save = seeded();
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
  let save = seeded();
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
  let save = seeded();
  const target = save.dragons[0];
  save = { ...save, dragons: [...save.dragons, { ...make(target.speciesId), tier: 2 }] };
  assert.ok(!merge(pack, save, target.id).ok);
});

console.log(`\n${passed} checks passed\n`);
