import { defaultContentPack, SCHEMA_VERSION, SHIPPED_VERSION } from "./content";
import { rollIv } from "./engine";
import { IV_MAX, IV_MIN } from "./types";
import type { ContentPack, Dragon, SaveGame } from "./types";

export const PACK_KEY = "dragonkeep.pack.v1";
export const SAVE_KEY = "dragonkeep.save.v1";

// Local storage today; swap these four functions for database calls when you
// add accounts and nothing else in the game has to change.

/**
 * A player's browser holds whatever pack it last saw, including any Admin edits
 * they made themselves. That copy is kept — unless the repo has shipped a newer
 * version, in which case the shipped one wins and replaces it.
 *
 * So: raise `version` in pack.json and everyone picks the change up on their
 * next visit. Leave it alone and local edits are left alone too.
 */
export function loadPack(): ContentPack {
  if (typeof window === "undefined") return defaultContentPack();
  try {
    const raw = window.localStorage.getItem(PACK_KEY);
    if (!raw) return defaultContentPack();

    const stored = migratePack(JSON.parse(raw) as ContentPack);
    if ((stored.version ?? 0) < SHIPPED_VERSION) {
      const fresh = defaultContentPack();
      savePack(fresh);
      return fresh;
    }
    return stored;
  } catch {
    return defaultContentPack();
  }
}

/** True when the browser is running content the repo has since replaced. */
export function packIsStale(pack: ContentPack): boolean {
  return (pack.version ?? 0) < SHIPPED_VERSION;
}

export function savePack(pack: ContentPack) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PACK_KEY, JSON.stringify(pack));
  } catch {
    /* quota exceeded — the download button is the real backup */
  }
}

export function loadSave(): SaveGame | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SaveGame) : null;
  } catch {
    return null;
  }
}

export function writeSave(save: SaveGame) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    /* ignore */
  }
}

export function clearAll() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SAVE_KEY);
  window.localStorage.removeItem(PACK_KEY);
}

/**
 * Earlier saves carried a `traits` object, then a per-stat `ivs` map. Rather
 * than discarding those dragons, give them a single fresh roll and move on.
 */
export function migrateSave(pack: ContentPack, save: SaveGame): SaveGame {
  // A dragon whose species has since been deleted from the pack has nothing to
  // read its name, colour or branch from. Rather than leave it to crash a lookup
  // somewhere, it is dropped here.
  const known = (id: string) => Boolean(pack.species[id]);

  const dragons = save.dragons
    .filter((d) => known(d.speciesId))
    .map((dragon) => {
    const patched = { ...dragon } as Dragon & Record<string, unknown>;
    if (typeof patched.iv !== "number" || patched.iv < IV_MIN || patched.iv > IV_MAX) {
      patched.iv = rollIv(pack);
    }
    // Fields removed since these saves were written.
    for (const gone of ["traits", "ivs", "source", "generation", "mergeCount"]) {
      delete patched[gone];
    }
    return patched as Dragon;
  });

  // Bakeries used to bake passively at a level. They are now ovens that run one
  // batch at a time, so anything old comes back idle rather than broken.
  const bakeries = (save.bakeries ?? []).map((oven) => {
    const loose = oven as unknown as Record<string, unknown>;
    if (typeof loose.batchId === "undefined")
      return { id: oven.id, batchId: null, startedAt: 0, readyAt: 0 };
    return oven;
  });

  // An egg part-way through hatching something that no longer exists, or laid by
  // parents that have since been dropped, is cleared rather than left dangling.
  const ids = new Set(dragons.map((d) => d.id));
  const breeding =
    save.breeding &&
    known(save.breeding.resultSpeciesId) &&
    ids.has(save.breeding.parentA) &&
    ids.has(save.breeding.parentB)
      ? save.breeding
      : null;

  return {
    ...save,
    schemaVersion: SCHEMA_VERSION,
    dragons,
    bakeries,
    breeding,
    discovered: (save.discovered ?? []).filter(known),
    adminMode: save.adminMode ?? false,
  };
}

function migratePack(pack: ContentPack): ContentPack {
  // Older packs get missing fields filled from the defaults rather than thrown
  // away, so adding a balance field never breaks someone's saved content.
  const base = defaultContentPack();
  return {
    ...base,
    ...pack,
    schemaVersion: SCHEMA_VERSION,
    version: pack.version ?? 1,
    iv: { ...base.iv, ...(pack.iv ?? {}) },
    balance: { ...base.balance, ...pack.balance },
    custom: { ...base.custom, ...(pack.custom ?? {}) },
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function readJsonFile<T>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T);
      } catch {
        reject(new Error("That file is not valid JSON."));
      }
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsText(file);
  });
}

// --- Validation ------------------------------------------------------------
// Run after every admin edit so broken content is caught before it reaches a
// player, and surfaced in plain language.

export interface Issue {
  level: "error" | "warning";
  where: string;
  message: string;
}

export function validatePack(pack: ContentPack): Issue[] {
  const issues: Issue[] = [];

  for (const taxon of Object.values(pack.taxa)) {
    if (taxon.parentId && !pack.taxa[taxon.parentId]) {
      issues.push({
        level: "error",
        where: `Taxon “${taxon.name}”`,
        message: "Its parent no longer exists. Move it or it will vanish from the tree.",
      });
    }
  }

  for (const species of Object.values(pack.species)) {
    if (!pack.taxa[species.taxonId])
      issues.push({
        level: "error",
        where: species.name,
        message: "Sits in a taxon that no longer exists.",
      });
    if (species.baseProduction <= 0)
      issues.push({
        level: "warning",
        where: species.name,
        message: "Produces no coins at all.",
      });
  }

  const reachable = new Set<string>(pack.balance.startingSpecies);
  for (const species of Object.values(pack.species)) {
    if (species.marketPrice) reachable.add(species.id);
  }
  for (const rule of pack.breedingRules) {
    if (!rule.enabled) continue;
    for (const outcome of rule.outcomes) reachable.add(outcome.speciesId);
  }

  for (const rule of pack.breedingRules) {
    for (const outcome of rule.outcomes) {
      if (!pack.species[outcome.speciesId])
        issues.push({
          level: "error",
          where: `Rule “${rule.label}”`,
          message: `Points at a species that does not exist (${outcome.speciesId}).`,
        });
      if (outcome.weight <= 0)
        issues.push({
          level: "warning",
          where: `Rule “${rule.label}”`,
          message: "An outcome has zero weight, so it can never be rolled.",
        });
    }
    for (const matcher of [rule.a, rule.b]) {
      if (matcher.kind === "species" && !pack.species[matcher.speciesId])
        issues.push({
          level: "error",
          where: `Rule “${rule.label}”`,
          message: "Matches a species that does not exist.",
        });
      if (matcher.kind === "taxon" && !pack.taxa[matcher.taxonId])
        issues.push({
          level: "error",
          where: `Rule “${rule.label}”`,
          message: "Matches a taxon that does not exist.",
        });
    }
  }

  for (const species of Object.values(pack.species)) {
    if (species.obtainable && !reachable.has(species.id))
      issues.push({
        level: "warning",
        where: species.name,
        message: "No way to obtain it — not for sale, not a starter, not in any rule.",
      });
  }

  if (pack.iv.productionMagnitude === 0 && pack.iv.growthMagnitude === 0)
    issues.push({
      level: "warning",
      where: "Individual value",
      message: "Both magnitudes are 0, so the roll is decorative — every dragon performs identically.",
    });

  for (const species of Object.values(pack.species)) {
    if (species.coinStorageHours !== undefined && species.coinStorageHours < 0)
      issues.push({
        level: "error",
        where: species.name,
        message: "Storage hours cannot be negative.",
      });
    if (species.coinCapacity !== undefined && species.coinCapacity < 0)
      issues.push({
        level: "error",
        where: species.name,
        message: "The coin cap cannot be negative.",
      });
    if (
      species.coinCapacity !== undefined &&
      species.coinCapacity > 0 &&
      species.coinCapacity < species.baseProduction
    )
      issues.push({
        level: "warning",
        where: species.name,
        message: "Its coin cap is under one hour of output, so it fills almost immediately.",
      });
    const secs = species.incubationSeconds;
    if (secs !== undefined && secs < 0)
      issues.push({
        level: "error",
        where: species.name,
        message: "Incubation time cannot be negative.",
      });
  }

  for (const id of pack.balance.startingSpecies) {
    if (!pack.species[id])
      issues.push({
        level: "error",
        where: "Starting dragons",
        message: `“${id}” is not a real species.`,
      });
  }

  return issues;
}
