import type { BreedingRule, ContentPack, Rarity, Species, Taxon } from "./types";

export const SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
// PLACEHOLDER CONTENT.
//
// Nothing here is meant to ship. It exists so every mechanism has something to
// stand on: a taxonomy a few levels deep, one dragon at several rarities, and
// one breeding rule of each kind. Replace all of it in Admin, then download the
// pack.
// ---------------------------------------------------------------------------

const taxa: Taxon[] = [
  {
    id: "root",
    name: "Root",
    parentId: null,
    rank: "Root",
    description: "Placeholder root. Everything hangs off this.",
    custom: {},
  },
  {
    id: "branch-a",
    name: "Branch A",
    parentId: "root",
    rank: "Group",
    description: "Placeholder group.",
    custom: {},
  },
  {
    id: "branch-a-1",
    name: "Sub-branch A1",
    parentId: "branch-a",
    rank: "Subgroup",
    description: "Placeholder subgroup, three levels deep, to show the tree has no depth limit.",
    custom: {},
  },
  {
    id: "branch-b",
    name: "Branch B",
    parentId: "root",
    rank: "Group",
    description: "Placeholder group.",
    custom: {},
  },
  {
    id: "branch-b-1",
    name: "Sub-branch B1",
    parentId: "branch-b",
    rank: "Subgroup",
    description: "Placeholder subgroup.",
    custom: {},
  },
  {
    id: "crossbreeds",
    name: "Crossbreeds",
    parentId: "root",
    rank: "Group",
    description: "Placeholder home for results that belong to no single branch.",
    custom: {},
  },
];

// Rarities are structure rather than content, so these are real. Retune freely.
const rarities: Rarity[] = [
  { id: "common", name: "Common", order: 1, color: "#8A93A6", productionMultiplier: 1, xpMultiplier: 1, mergeCosts: [2, 3, 4, 5], maxTier: 5 },
  { id: "uncommon", name: "Uncommon", order: 2, color: "#5FA98A", productionMultiplier: 1.35, xpMultiplier: 1.25, mergeCosts: [2, 3, 4, 5], maxTier: 5 },
  { id: "rare", name: "Rare", order: 3, color: "#4E86C7", productionMultiplier: 1.9, xpMultiplier: 1.6, mergeCosts: [2, 3, 4, 6], maxTier: 5 },
  { id: "epic", name: "Epic", order: 4, color: "#9B6BC9", productionMultiplier: 2.7, xpMultiplier: 2.1, mergeCosts: [3, 4, 5, 7], maxTier: 5 },
  { id: "legendary", name: "Legendary", order: 5, color: "#D9A441", productionMultiplier: 3.8, xpMultiplier: 2.8, mergeCosts: [3, 4, 6, 8], maxTier: 5 },
  { id: "mythic", name: "Mythic", order: 6, color: "#C8536B", productionMultiplier: 5.5, xpMultiplier: 3.6, mergeCosts: [4, 5, 7, 10], maxTier: 5 },
];

const PLACEHOLDER = "Placeholder. Replace this dragon in Admin.";

const species: Species[] = [
  {
    id: "placeholder-1",
    name: "Placeholder 1",
    taxonId: "branch-a-1",
    rarityId: "common",
    tags: ["example-tag"],
    baseProduction: 20,
    incubationSeconds: 60,
    obtainable: true,
    marketPrice: 250,
    description: PLACEHOLDER,
    custom: {},
  },
  {
    id: "placeholder-2",
    name: "Placeholder 2",
    taxonId: "branch-b-1",
    rarityId: "common",
    tags: [],
    baseProduction: 22,
    incubationSeconds: 60,
    obtainable: true,
    marketPrice: 250,
    description: PLACEHOLDER,
    custom: {},
  },
  {
    id: "placeholder-3",
    name: "Placeholder 3",
    taxonId: "branch-a-1",
    rarityId: "uncommon",
    tags: ["example-tag"],
    baseProduction: 48,
    incubationSeconds: 420,
    obtainable: true,
    description: PLACEHOLDER,
    custom: {},
  },
  {
    id: "placeholder-4",
    name: "Placeholder 4",
    taxonId: "branch-b-1",
    rarityId: "rare",
    tags: [],
    baseProduction: 95,
    incubationSeconds: 1800,
    obtainable: true,
    description: PLACEHOLDER,
    custom: {},
  },
  {
    id: "placeholder-5",
    name: "Placeholder 5",
    taxonId: "crossbreeds",
    rarityId: "legendary",
    tags: [],
    baseProduction: 400,
    incubationSeconds: 3600,
    obtainable: true,
    description: PLACEHOLDER,
    custom: {},
  },
];

// One rule of each kind, so the shape of each is visible before you write your own.
const breedingRules: BreedingRule[] = [
  {
    id: "rule-example-species",
    label: "Named pair",
    a: { kind: "species", speciesId: "placeholder-1" },
    b: { kind: "species", speciesId: "placeholder-2" },
    outcomes: [{ speciesId: "placeholder-3", weight: 30 }],
    exclusive: false,
    priority: 0,
    enabled: true,
    notes: "Two exact dragons. The parents stay in the pool, so this is a strong chance, not a certainty.",
  },
  {
    id: "rule-example-taxon",
    label: "Within Branch B",
    a: { kind: "taxon", taxonId: "branch-b", includeDescendants: true },
    b: { kind: "taxon", taxonId: "branch-b", includeDescendants: true },
    outcomes: [{ speciesId: "placeholder-4", weight: 8 }],
    exclusive: false,
    priority: 0,
    enabled: true,
    notes: "Fires for anything under Branch B, at any depth.",
  },
  {
    id: "rule-example-tag",
    label: "Tagged pair",
    a: { kind: "tag", tag: "example-tag" },
    b: { kind: "tag", tag: "example-tag" },
    outcomes: [{ speciesId: "placeholder-3", weight: 12 }],
    exclusive: false,
    priority: 0,
    enabled: true,
    notes: "Tags cut across the tree, so this can fire for parents in unrelated branches.",
  },
  {
    id: "rule-guaranteed",
    label: "Guaranteed result",
    a: { kind: "species", speciesId: "placeholder-3" },
    b: { kind: "species", speciesId: "placeholder-4" },
    outcomes: [{ speciesId: "placeholder-5", weight: 1 }],
    conditions: { minTier: 2, onlyIfUndiscovered: ["placeholder-5"] },
    exclusive: true,
    priority: 100,
    enabled: true,
    notes: "Exclusive rules replace the whole pool, so the result is certain. Gated behind tier 2 on both parents, and stops firing once one has been obtained.",
  },
];

export function defaultContentPack(): ContentPack {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: "Placeholder set",
    taxa: Object.fromEntries(taxa.map((t) => [t.id, t])),
    rarities: Object.fromEntries(rarities.map((r) => [r.id, r])),
    species: Object.fromEntries(species.map((s) => [s.id, s])),
    iv: {
      name: "Individual Value",
      description: "Rolled 0-31 when the dragon hatches. Fixed for life, never inherited.",
      productionMagnitude: 0.25,
      growthMagnitude: 0,
    },
    breedingRules,
    balance: {
      startingCoins: 600,
      startingFood: 60,
      startingSpecies: ["placeholder-1", "placeholder-2"],
      roostCapacity: 6,
      roostSlotCost: 800,
      roostSlotCostGrowth: 1.6,

      production: { levelCoefficient: 0.12, levelExponent: 1, tierMultiplier: 1.65 },
      coinStorageHours: 8,

      levelXpBase: 50,
      levelXpExponent: 1.45,
      maxLevel: 40,

      parentWeight: 50,
      defaultIncubationSeconds: 60,

      maxBakeries: 3,
      bakeryCostGrowth: 3,
      foodTypes: [
        { id: "food-1", name: "Placeholder Food 1", foodCost: 5, xp: 12, unlocksAtBakeryLevel: 1 },
        { id: "food-2", name: "Placeholder Food 2", foodCost: 20, xp: 60, unlocksAtBakeryLevel: 2 },
        { id: "food-3", name: "Placeholder Food 3", foodCost: 60, xp: 220, unlocksAtBakeryLevel: 3 },
        { id: "food-4", name: "Placeholder Food 4", foodCost: 200, xp: 900, unlocksAtBakeryLevel: 4 },
      ],
      bakeryTiers: [
        { level: 1, cost: 350, foodPerHour: 30, storage: 120 },
        { level: 2, cost: 1400, foodPerHour: 72, storage: 340 },
        { level: 3, cost: 5600, foodPerHour: 165, storage: 820 },
        { level: 4, cost: 21000, foodPerHour: 380, storage: 2000 },
        { level: 5, cost: 78000, foodPerHour: 900, storage: 5000 },
      ],
    },
    custom: {},
  };
}
