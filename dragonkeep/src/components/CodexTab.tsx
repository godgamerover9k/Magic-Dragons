"use client";

import { useState } from "react";
import { formatDuration, formatNumber, incubationSeconds } from "@/game/economy";
import { childrenOf, roots, speciesInTaxon } from "@/game/taxonomy";
import type { Species, Taxon } from "@/game/types";
import type { Game } from "@/game/useGame";
import { Panel, SectionHeading } from "./ui";

// The signature view: the taxonomy drawn as a cladogram, with undiscovered
// branches held in silhouette. The tree is the collection.

export function CodexTab({ game }: { game: Game }) {
  const { pack, save } = game;
  const [openSpecies, setOpenSpecies] = useState<string | null>(null);
  if (!save) return null;

  const all = Object.values(pack.species);
  const found = all.filter((s) => save.discovered.includes(s.id)).length;

  return (
    <div className="space-y-3">
      <SectionHeading
        label="Codex"
        aside={
          <span className="num text-xs text-muted">
            {found}/{all.length} recorded
          </span>
        }
      />

      <Panel className="p-3">
        {roots(pack).map((taxon) => (
          <Branch
            key={taxon.id}
            taxon={taxon}
            game={game}
            depth={0}
            openSpecies={openSpecies}
            setOpenSpecies={setOpenSpecies}
          />
        ))}
      </Panel>

      <p className="px-1 text-[11px] text-muted">
        Every rank shown here can be targeted by a breeding rule. A rule aimed at a branch
        applies to everything beneath it.
      </p>
    </div>
  );
}

function Branch({
  taxon,
  game,
  depth,
  openSpecies,
  setOpenSpecies,
}: {
  taxon: Taxon;
  game: Game;
  depth: number;
  openSpecies: string | null;
  setOpenSpecies: (id: string | null) => void;
}) {
  const { pack, save } = game;
  const kids = childrenOf(pack, taxon.id);
  const own = Object.values(pack.species).filter((s) => s.taxonId === taxon.id);
  const beneath = speciesInTaxon(pack, taxon.id);
  const found = beneath.filter((s) => save?.discovered.includes(s.id)).length;
  const complete = beneath.length > 0 && found === beneath.length;

  return (
    <div className={depth > 0 ? "relative branch pl-4" : ""}>
      <div className="py-1.5">
        <div className="flex items-baseline gap-2">
          <span
            className="font-display text-sm"
            style={{ color: complete ? "var(--color-verdigris)" : undefined }}
          >
            {taxon.name}
          </span>
          {taxon.rank && <span className="eyebrow">{taxon.rank}</span>}
          <span className="num ml-auto text-[11px] text-muted">
            {found}/{beneath.length}
          </span>
        </div>
        {taxon.description && depth < 2 && (
          <p className="mt-0.5 max-w-prose text-[11px] leading-snug text-muted">
            {taxon.description}
          </p>
        )}
      </div>

      <div className="space-y-0.5">
        {own.map((species) => (
          <SpeciesRow
            key={species.id}
            species={species}
            game={game}
            open={openSpecies === species.id}
            onToggle={() =>
              setOpenSpecies(openSpecies === species.id ? null : species.id)
            }
          />
        ))}
      </div>

      {kids.map((child) => (
        <Branch
          key={child.id}
          taxon={child}
          game={game}
          depth={depth + 1}
          openSpecies={openSpecies}
          setOpenSpecies={setOpenSpecies}
        />
      ))}
    </div>
  );
}

function SpeciesRow({
  species,
  game,
  open,
  onToggle,
}: {
  species: Species;
  game: Game;
  open: boolean;
  onToggle: () => void;
}) {
  const { pack, save } = game;
  const known = save?.discovered.includes(species.id) ?? false;
  const owned = save?.dragons.filter((d) => d.speciesId === species.id) ?? [];
  const rarity = pack.rarities[species.rarityId];
  const best = owned.reduce(
    (acc, d) => (d.tier > acc.tier || (d.tier === acc.tier && d.level > acc.level) ? d : acc),
    owned[0],
  );

  return (
    <div className="relative branch branch-tick pl-4">
      <button
        type="button"
        onClick={onToggle}
        disabled={!known}
        className="flex w-full items-center gap-2 py-1 text-left disabled:cursor-default"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: known ? rarity?.color : "var(--color-line)" }}
        />
        <span className={`truncate text-sm ${known ? "" : "text-muted/50"}`}>
          {known ? species.name : "—— unrecorded ——"}
        </span>
        {known && owned.length > 0 && (
          <span className="num ml-auto shrink-0 text-[11px] text-muted">
            ×{owned.length}
            {best ? ` · T${best.tier}` : ""}
          </span>
        )}
      </button>

      {open && known && (
        <div className="mb-2 rounded border border-line bg-raised p-2.5">
          <p className="text-[11px] leading-snug text-muted">{species.description}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span className="num" style={{ color: rarity?.color }}>
              {rarity?.name}
            </span>
            <span className="num text-muted">
              {formatNumber(species.baseProduction)} base coins/hr
            </span>
            <span className="num text-muted">
              {formatDuration(incubationSeconds(pack, species.id) * 1000)} to hatch
            </span>
            {species.tags.map((t) => (
              <span key={t} className="eyebrow">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
