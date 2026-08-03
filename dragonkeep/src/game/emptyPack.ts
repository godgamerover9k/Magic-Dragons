import type { ContentPack } from "./types";
import type { RedactedPack } from "./redact";

// What the client holds before the server has answered. Deliberately empty —
// the browser bundle must not contain a single dragon name, so there is nothing
// here to fall back to.

export const EMPTY_PACK: RedactedPack = {
  schemaVersion: 0,
  version: 0,
  name: "",
  taxa: {},
  species: {},
  iv: {
    name: "Individual Value",
    description: "",
    curveExponent: 1,
    disadvantage: false,
    productionMagnitude: 0,
    growthMagnitude: 0,
  },
  breedingRules: [],
  balance: {
    startingCoins: 0,
    startingFood: 0,
    startingSpecies: [],
    roostCapacity: 0,
    roostSlotCost: 0,
    roostSlotCostExponent: 2,
    power: { tierWeight: 1 },
    production: { exponent: 1 },
    capacity: { exponent: 1 },
    coinStorageHours: 1,
    mergeCosts: [2],
    maxTier: 1,
    levelXpBase: 1,
    levelXpExponent: 1,
    maxLevel: 1,
    xpPerFood: 1,
    parentWeight: 1,
    defaultIncubationSeconds: 0,
    maxBakeries: 0,
    bakeryCost: 0,
    bakeryCostGrowth: 1,
    foodBatches: [],
  },
  custom: {},
  totalSpecies: 0,
  complete: false,
} satisfies ContentPack & { totalSpecies: number; complete: boolean };
