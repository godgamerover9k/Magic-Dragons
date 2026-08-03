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

/**
 * Named branches sort before anonymous ones, so what a player has found sits at
 * the top and the unknowns collect underneath. Within each group, by name.
 */
function byName(a: Taxon, b: Taxon) {
  const known = (t: Taxon) => (t.name ? 0 : 1);
  return known(a) - known(b) || a.name.localeCompare(b.name);
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

/**
 * The branch directly beneath `ancestorId` that `id` sits in, or null when it is
 * not beneath it at all. Lets a rule ask "which element is this dragon in?"
 * without caring how deeply it is filed inside that element.
 */
export function branchUnder(
  pack: ContentPack,
  id: TaxonId,
  ancestorId: TaxonId,
): TaxonId | null {
  const line = ancestry(pack, id);
  for (const taxon of line) {
    if (taxon.parentId === ancestorId) return taxon.id;
  }
  return null;
}

/** What deleting a taxon would displace. */
export function removalImpact(pack: ContentPack, id: TaxonId) {
  return {
    children: childrenOf(pack, id),
    species: Object.values(pack.species).filter((s) => s.taxonId === id),
  };
}

/**
 * Deletes a taxon and rehomes whatever it held. Sub-branches and dragons sitting
 * directly on it move to `destinationId`, which defaults to its parent. Passing
 * null promotes sub-branches to the top level — only legal when no dragon sits
 * directly on the node, since every dragon needs a real branch.
 */
export function removeTaxon(
  pack: ContentPack,
  id: TaxonId,
  destinationId: TaxonId | null,
): { pack: ContentPack; error: string | null } {
  const node = pack.taxa[id];
  if (!node) return { pack, error: "That branch no longer exists." };
  if (destinationId === id)
    return { pack, error: "Pick somewhere other than the branch being deleted." };
  if (destinationId && !pack.taxa[destinationId])
    return { pack, error: "That destination no longer exists." };
  if (destinationId && isWithin(pack, destinationId, id))
    return {
      pack,
      error: "That destination sits inside the branch being deleted.",
    };

  const { species } = removalImpact(pack, id);
  if (species.length > 0 && destinationId === null)
    return {
      pack,
      error: `${species.length} dragon${species.length === 1 ? "" : "s"} sit here and need a branch. Choose one to move them to.`,
    };

  const taxa: Record<TaxonId, Taxon> = {};
  for (const taxon of Object.values(pack.taxa)) {
    if (taxon.id === id) continue;
    taxa[taxon.id] =
      taxon.parentId === id ? { ...taxon, parentId: destinationId } : taxon;
  }

  const speciesMap = { ...pack.species };
  for (const s of species) {
    speciesMap[s.id] = { ...s, taxonId: destinationId! };
  }

  // Rules pointing at the deleted branch would silently stop firing, so send
  // them to the destination too rather than leaving a dangling reference.
  const breedingRules = pack.breedingRules.map((rule) => {
    const fix = (m: typeof rule.a) =>
      m.kind === "taxon" && m.taxonId === id
        ? destinationId
          ? { ...m, taxonId: destinationId }
          : ({ kind: "any" } as typeof rule.a)
        : m;
    return { ...rule, a: fix(rule.a), b: fix(rule.b) };
  });

  return { pack: { ...pack, taxa, species: speciesMap, breedingRules }, error: null };
}
