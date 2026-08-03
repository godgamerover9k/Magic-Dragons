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

  if (isAdmin) return { ...pack, totalSpecies: total, complete: true };

  const keepSpecies = visibleSpecies(pack, save);
  const keepTaxa = visibleTaxa(pack, keepSpecies);

  const species = Object.fromEntries(
    [...keepSpecies].map((id) => [id, pack.species[id]]),
  );

  const taxa: Record<TaxonId, Taxon> = {};
  for (const id of keepTaxa) {
    const node = pack.taxa[id];
    if (!node) continue;
    // A parent that is itself hidden would leave a dangling reference, so the
    // branch is re-rooted at the highest visible ancestor.
    const parentId = node.parentId && keepTaxa.has(node.parentId) ? node.parentId : null;
    taxa[id] = { ...node, parentId };
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
    complete: false,
  };
}
