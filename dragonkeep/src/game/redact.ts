import { ancestry } from "./taxonomy";
import type { ContentPack, SaveGame, SpeciesId, Taxon, TaxonId } from "./types";

// ---------------------------------------------------------------------------
// What a player is allowed to know.
//
// The pack holds every dragon, every branch and every breeding weight. Sending
// it to the browser would put the whole game in a file anyone can open, so the
// client is given only the part it has earned: dragons it has discovered or can
// buy, the branches those sit in, and nothing else.
//
// Breeding rules never leave the server for an ordinary player. Not the weights,
// not the conditions, not the names of what they produce.
// ---------------------------------------------------------------------------

export interface RedactedPack extends ContentPack {
  /** How many dragons exist in total, so progress can be shown as "3 of 14". */
  totalSpecies: number;
  /**
   * How many dragons really sit beneath each branch, counted against the full
   * pack rather than the slice sent down.
   *
   * Only present for branches the player has actually found something in. A
   * branch they have never touched is not listed at all — telling them it holds
   * three dragons is itself information they have not earned.
   */
  branchTotals: Record<TaxonId, number>;
  /** True when this is the whole pack, i.e. a designer or local play. */
  complete: boolean;
}

/** Dragons a player may see: whatever they have found, plus the shop. */
function visibleSpecies(pack: ContentPack, save: SaveGame | null): Set<SpeciesId> {
  const out = new Set<SpeciesId>();
  for (const id of save?.discovered ?? []) if (pack.species[id]) out.add(id);
  for (const d of save?.dragons ?? []) if (pack.species[d.speciesId]) out.add(d.speciesId);
  // Anything on sale is on sale — hiding it would hide the shop.
  for (const s of Object.values(pack.species))
    if (s.marketPrice && s.marketPrice > 0 && s.obtainable) out.add(s.id);
  // A dragon part-way through hatching needs its name at the reveal.
  if (save?.breeding?.resultSpeciesId && pack.species[save.breeding.resultSpeciesId])
    out.add(save.breeding.resultSpeciesId);
  return out;
}

/** Branches are visible only because something visible sits in them. */
function visibleTaxa(pack: ContentPack, species: Set<SpeciesId>): Set<TaxonId> {
  const out = new Set<TaxonId>();
  for (const id of species) {
    const taxonId = pack.species[id]?.taxonId;
    if (!taxonId) continue;
    for (const node of ancestry(pack, taxonId)) out.add(node.id);
  }
  return out;
}

export function redactPack(
  pack: ContentPack,
  save: SaveGame | null,
  isAdmin: boolean,
): RedactedPack {
  const total = Object.keys(pack.species).length;

  /**
   * Real totals per branch, computed before anything is hidden — but withheld
   * for any branch where nothing has been discovered yet.
   */
  const totals = (map: Map<TaxonId, TaxonId>, everything: boolean) => {
    const counted: Record<TaxonId, number> = {};
    const found: Record<TaxonId, number> = {};
    const discovered = new Set(save?.discovered ?? []);

    for (const species of Object.values(pack.species)) {
      for (const node of ancestry(pack, species.taxonId)) {
        const key = map.get(node.id) ?? node.id;
        counted[key] = (counted[key] ?? 0) + 1;
        if (discovered.has(species.id)) found[key] = (found[key] ?? 0) + 1;
      }
    }

    if (everything) return counted;
    return Object.fromEntries(
      Object.entries(counted).filter(([key]) => (found[key] ?? 0) > 0),
    );
  };

  if (isAdmin)
    return {
      ...pack,
      totalSpecies: total,
      branchTotals: totals(new Map(), true),
      complete: true,
    };

  const keepSpecies = visibleSpecies(pack, save);
  const named = visibleTaxa(pack, keepSpecies);

  const species = Object.fromEntries(
    [...keepSpecies].map((id) => [id, pack.species[id]]),
  );

  // The SHAPE of the tree is sent, so a player can see there is more to find.
  // Branches holding nothing they have unlocked arrive anonymous: no name, no
  // description, and an opaque id, since "duality" would give the game away as
  // surely as the name would. Order is fixed so the same branch keeps the same
  // placeholder between requests.
  const order = Object.keys(pack.taxa).sort();
  const alias = new Map<TaxonId, TaxonId>();
  let n = 0;
  for (const id of order) alias.set(id, named.has(id) ? id : `unknown-${++n}`);

  const taxa: Record<TaxonId, Taxon> = {};
  for (const id of order) {
    const node = pack.taxa[id];
    const shown = alias.get(id)!;
    const parentId = node.parentId ? (alias.get(node.parentId) ?? null) : null;
    taxa[shown] = named.has(id)
      ? { ...node, parentId }
      : { id: shown, name: "", parentId, rank: "", description: "", custom: {} };
  }

  return {
    ...pack,
    taxa,
    species,
    // The entire ruleset stays behind. Combos are for players to find.
    breedingRules: [],
    balance: {
      ...pack.balance,
      // Starting dragons are already visible; this list would leak nothing, but
      // there is no reason for the client to carry it.
      startingSpecies: [],
    },
    totalSpecies: total,
    branchTotals: totals(alias, false),
    complete: false,
  };
}
