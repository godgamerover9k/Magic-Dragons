import type { BreedingRule, ContentPack, Species, Taxon } from "./types";

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
    id: "dragon",
    name: "Dragon",
    parentId: null,
    rank: "Domain",
    description: "Everything hangs off this.",
    custom: {},
  },
  {
    id: "elemental",
    name: "Elemental",
    parentId: "dragon",
    rank: "Class",
    description: "Dragons bound to one of the four elements.",
    custom: {},
  },
  { id: "fire", name: "Fire", parentId: "elemental", rank: "Element", description: "", custom: {} },
  { id: "earth", name: "Earth", parentId: "elemental", rank: "Element", description: "", custom: {} },
  { id: "water", name: "Water", parentId: "elemental", rank: "Element", description: "", custom: {} },
  { id: "air", name: "Air", parentId: "elemental", rank: "Element", description: "", custom: {} },
];

const PLACEHOLDER = "Placeholder. Replace this dragon in Admin.";

const species: Species[] = [
  {
    id: "fire-dragon",
    name: "Fire Dragon",
    taxonId: "fire",
    color: "#D9633F",
    tags: ["example-tag"],
    baseProduction: 180,
    incubationSeconds: 60,
    obtainable: true,
    marketPrice: 2250,
    description: PLACEHOLDER,
    custom: {},
  },
  {
    id: "earth-dragon",
    name: "Earth Dragon",
    taxonId: "earth",
    color: "#7E9B62",
    tags: [],
    baseProduction: 216,
    coinStorageHours: 0.4,
    incubationSeconds: 120,
    obtainable: true,
    marketPrice: 4500,
    description: PLACEHOLDER,
    custom: {},
  },
  {
    id: "water-dragon",
    name: "Water Dragon",
    taxonId: "water",
    color: "#4E86C7",
    tags: [],
    baseProduction: 252,
    coinStorageHours: 0.5,
    incubationSeconds: 300,
    obtainable: true,
    marketPrice: 8100,
    description: PLACEHOLDER,
    custom: {},
  },
  {
    id: "air-dragon",
    name: "Air Dragon",
    taxonId: "air",
    color: "#9FB6C9",
    tags: ["example-tag"],
    baseProduction: 583,
    xpMultiplier: 1.25,
    coinStorageHours: 0.75,
    incubationSeconds: 600,
    obtainable: true,
    description: PLACEHOLDER + " Not sold — bred only.",
    custom: {},
  },
  {
    id: "elder-dragon",
    name: "Elder Dragon",
    taxonId: "elemental",
    color: "#D9A441",
    tags: [],
    baseProduction: 13680,
    xpMultiplier: 2.8,
    mergeCosts: [3, 4, 6, 8],
    coinStorageHours: 1.5,
    incubationSeconds: 3600,
    obtainable: true,
    description: PLACEHOLDER + " Sits on the Elemental branch rather than in any one element.",
    custom: {},
  },
];

// One rule of each kind, so the shape of each is visible before you write your own.
const breedingRules: BreedingRule[] = [
  {
    id: "rule-example-species",
    label: "Named pair",
    a: { kind: "species", speciesId: "fire-dragon" },
    b: { kind: "species", speciesId: "earth-dragon" },
    outcomes: [{ speciesId: "air-dragon", weight: 30 }],
    exclusive: false,
    priority: 0,
    enabled: true,
    notes: "Two exact dragons. The parents stay in the pool, so this is a strong chance, not a certainty.",
  },
  {
    id: "rule-example-taxon",
    label: "Fire and Water",
    a: { kind: "taxon", taxonId: "fire", includeDescendants: true },
    b: { kind: "taxon", taxonId: "water", includeDescendants: true },
    outcomes: [{ speciesId: "air-dragon", weight: 12 }],
    exclusive: false,
    priority: 0,
    enabled: true,
    notes: "Matches anything under an element, at any depth, rather than one named dragon.",
  },
  {
    id: "rule-example-tag",
    label: "Tagged pair",
    a: { kind: "tag", tag: "example-tag" },
    b: { kind: "tag", tag: "example-tag" },
    outcomes: [{ speciesId: "water-dragon", weight: 10 }],
    exclusive: false,
    priority: 0,
    enabled: true,
    notes: "Tags cut across the tree, so this fires for parents in unrelated elements.",
  },
  {
    id: "rule-guaranteed",
    label: "Guaranteed result",
    a: { kind: "species", speciesId: "air-dragon" },
    b: { kind: "species", speciesId: "water-dragon" },
    outcomes: [{ speciesId: "elder-dragon", weight: 1 }],
    conditions: { minTier: 2, onlyIfUndiscovered: ["elder-dragon"] },
    exclusive: true,
    priority: 100,
    enabled: true,
    notes: "Exclusive rules replace the whole pool, so the result is certain. Gated behind tier 2 on both parents, and stops firing once one has been obtained.",
  },
];

export function defaultContentPack(): ContentPack {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: "Elemental placeholder set",
    taxa: Object.fromEntries(taxa.map((t) => [t.id, t])),
    species: Object.fromEntries(species.map((s) => [s.id, s])),
    iv: {
      name: "Individual Value",
      description: "Rolled 0-31 when the dragon hatches. Fixed for life, never inherited.",
      // Cubed, so the bottom of the range is nearly worthless and the last few
      // points carry most of the value. Rolled with disadvantage on top of that.
      curveExponent: 3,
      disadvantage: true,
      productionMagnitude: 0.6,
      growthMagnitude: 0,
    },
    breedingRules,
    balance: {
      startingCoins: 5400,
      startingFood: 60,
      startingSpecies: ["fire-dragon", "earth-dragon"],
      roostCapacity: 6,
      roostSlotCost: 7200,
      // Quadratic: 7200, 28800, 64800, 115200 …
      roostSlotCostExponent: 2,

      // Level and tier become one number. A tier step is worth twelve levels,
      // so tiering matters far more than grinding.
      power: { tierWeight: 12 },
      // Both exponents sit below 1, so power has diminishing returns. Capacity's
      // is the higher of the two, so a raised dragon holds more hours of output.
      production: { exponent: 0.139 },
      capacity: { exponent: 0.30 },
      coinStorageHours: 1 / 3,

      // Defaults for any dragon that does not set its own.
      mergeCosts: [2, 3, 4, 5],
      maxTier: 5,

      levelXpBase: 50,
      levelXpExponent: 1.45,
      maxLevel: 40,

      parentWeight: 50,
      defaultIncubationSeconds: 60,

      maxBakeries: 3,
      bakeryCost: 3150,
      bakeryCostGrowth: 3,
      foodTypes: [
        { id: "food-1", name: "Placeholder Food 1", foodCost: 5, xp: 12 },
        { id: "food-2", name: "Placeholder Food 2", foodCost: 20, xp: 60 },
        { id: "food-3", name: "Placeholder Food 3", foodCost: 60, xp: 220 },
        { id: "food-4", name: "Placeholder Food 4", foodCost: 200, xp: 900 },
      ],
      // The first is free so a player can never be stranded with no food and no
      // coins. Each step up costs more, takes longer, and pays better per minute.
      foodBatches: [
        { id: "batch-1", name: "Scraps", coinCost: 0, seconds: 120, food: 12 },
        { id: "batch-2", name: "Small Order", coinCost: 1350, seconds: 600, food: 80 },
        { id: "batch-3", name: "Standing Order", coinCost: 8100, seconds: 3600, food: 600 },
        { id: "batch-4", name: "Banquet", coinCost: 45000, seconds: 21600, food: 4500 },
      ],
    },
    custom: {},
  };
}
