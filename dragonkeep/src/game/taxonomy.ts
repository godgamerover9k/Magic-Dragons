import type { ContentPack, Taxon, TaxonId, Species } from "./types";

/** Root nodes, in name order. */
export function roots(pack: ContentPack): Taxon[] {
  return Object.values(pack.taxa)
    .filter((t) => t.parentId === null)
    .sort(byName);
}

export function childrenOf(pack: ContentPack, id: TaxonId): Taxon[] {
  return Object.values(pack.taxa)
    .filter((t) => t.parentId === id)
    .sort(byName);
}

function byName(a: Taxon, b: Taxon) {
  return a.name.localeCompare(b.name);
}

/** [self, parent, grandparent, ... root]. Cycle-safe. */
export function ancestry(pack: ContentPack, id: TaxonId): Taxon[] {
  const out: Taxon[] = [];
  const seen = new Set<TaxonId>();
  let current: Taxon | undefined = pack.taxa[id];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.push(current);
    current = current.parentId ? pack.taxa[current.parentId] : undefined;
  }
  return out;
}

/** True if `id` is `ancestorId` or sits anywhere beneath it. */
export function isWithin(
  pack: ContentPack,
  id: TaxonId,
  ancestorId: TaxonId,
): boolean {
  return ancestry(pack, id).some((t) => t.id === ancestorId);
}

/** "Draconia › Pyrodonta › Emberwyrm" */
export function taxonPath(pack: ContentPack, id: TaxonId, sep = " › "): string {
  return ancestry(pack, id)
    .reverse()
    .map((t) => t.name)
    .join(sep);
}

export function depthOf(pack: ContentPack, id: TaxonId): number {
  return ancestry(pack, id).length - 1;
}

/** Every taxon at or beneath `id`. */
export function subtree(pack: ContentPack, id: TaxonId): Taxon[] {
  const out: Taxon[] = [];
  const stack: TaxonId[] = [id];
  const seen = new Set<TaxonId>();
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const node = pack.taxa[next];
    if (!node) continue;
    out.push(node);
    for (const child of childrenOf(pack, next)) stack.push(child.id);
  }
  return out;
}

export function speciesInTaxon(
  pack: ContentPack,
  id: TaxonId,
  includeDescendants = true,
): Species[] {
  return Object.values(pack.species).filter((s) =>
    includeDescendants ? isWithin(pack, s.taxonId, id) : s.taxonId === id,
  );
}

/** Flattened tree for rendering, depth-first, with indent level. */
export interface TaxonRow {
  taxon: Taxon;
  depth: number;
  isLast: boolean;
}

export function flattenTree(pack: ContentPack): TaxonRow[] {
  const out: TaxonRow[] = [];
  const walk = (nodes: Taxon[], depth: number) => {
    nodes.forEach((taxon, i) => {
      out.push({ taxon, depth, isLast: i === nodes.length - 1 });
      walk(childrenOf(pack, taxon.id), depth + 1);
    });
  };
  walk(roots(pack), 0);
  return out;
}

/**
 * Moving a node under its own descendant would orphan the tree.
 * Returns null when the move is legal, or a reason when it is not.
 */
export function validateReparent(
  pack: ContentPack,
  id: TaxonId,
  newParentId: TaxonId | null,
): string | null {
  if (newParentId === null) return null;
  if (id === newParentId) return "A taxon cannot be its own parent.";
  if (!pack.taxa[newParentId]) return "That parent does not exist.";
  if (isWithin(pack, newParentId, id))
    return "That would put a taxon inside its own branch.";
  return null;
}
