"use client";

import { useState } from "react";
import { colorOf, formatDuration, formatNumber, incubationSeconds } from "@/game/economy";
import { childrenOf, roots, speciesInTaxon } from "@/game/taxonomy";
import type { Species, Taxon } from "@/game/types";
import type { Game } from "@/game/useGame";
import { Button, Panel, SectionHeading } from "./ui";

// The taxonomy drawn as a collapsible cladogram. Branches you have never had a
// dragon from stay anonymous, so the tree fills in as the collection does.

export function CodexTab({ game }: { game: Game }) {
  const { pack, save } = game;
  const [openSpecies, setOpenSpecies] = useState<string | null>(null);
  // Top-level branches start open; everything below waits to be asked for.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(roots(pack).map((t) => t.id)),
  );

  if (!save) return null;

  const visible = Object.values(pack.species);
  const found = visible.filter((s) => save.discovered.includes(s.id)).length;
  // The pack the client holds is cut down to what has been unlocked, so the
  // total has to come from the server rather than from counting what is here.
  const total = (pack as { totalSpecies?: number }).totalSpecies ?? visible.length;

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allIds = Object.keys(pack.taxa);
  const everythingOpen = allIds.every((id) => open.has(id));

  return (
    <div className="space-y-3">
      <SectionHeading
        label="Codex"
        aside={
          <span className="num text-xs text-muted">
            {found}/{total} recorded
          </span>
        }
      />

      <div className="flex justify-end">
        <Button
          variant="ghost"
          onClick={() => setOpen(everythingOpen ? new Set() : new Set(allIds))}
        >
          {everythingOpen ? "Collapse all" : "Expand all"}
        </Button>
      </div>

      <Panel className="p-3">
        {roots(pack).map((taxon) => (
          <Branch
            key={taxon.id}
            taxon={taxon}
            game={game}
            depth={0}
            open={open}
            toggle={toggle}
            openSpecies={openSpecies}
            setOpenSpecies={setOpenSpecies}
          />
        ))}
      </Panel>

      <p className="px-1 text-[11px] text-muted">
        Every branch shown here can be targeted by a breeding rule, which then applies to
        everything beneath it.
      </p>
    </div>
  );
}

function Branch({
  taxon,
  game,
  depth,
  open,
  toggle,
  openSpecies,
  setOpenSpecies,
}: {
  taxon: Taxon;
  game: Game;
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
  openSpecies: string | null;
  setOpenSpecies: (id: string | null) => void;
}) {
  const { pack, save } = game;
  const kids = childrenOf(pack, taxon.id);
  const own = Object.values(pack.species).filter((s) => s.taxonId === taxon.id);
  const beneath = speciesInTaxon(pack, taxon.id);
  const found = beneath.filter((s) => save?.discovered.includes(s.id)).length;
  // The denominator is the real one, sent by the server — and only sent at all
  // once something here has been found. A branch with nothing found shows no
  // count, because the client was never told what it holds.
  const totals = (pack as { branchTotals?: Record<string, number> }).branchTotals;
  const total = totals?.[taxon.id];
  const complete = total !== undefined && total > 0 && found === total;
  const known = found > 0;

  const expanded = open.has(taxon.id);
  const hasContents = kids.length > 0 || own.length > 0;

  return (
    <div className={depth > 0 ? "relative branch pl-4" : ""}>
      <button
        type="button"
        onClick={() => hasContents && toggle(taxon.id)}
        aria-expanded={hasContents ? expanded : undefined}
        disabled={!hasContents}
        className="w-full py-1.5 text-left"
      >
        <div className="flex items-baseline gap-2">
          <span
            className="w-3 shrink-0 text-[10px] text-muted"
            aria-hidden="true"
          >
            {hasContents ? (expanded ? "▾" : "▸") : ""}
          </span>
          <span
            className={`font-display text-sm ${known ? "" : "text-muted/50"}`}
            style={{ color: complete ? "var(--color-verdigris)" : undefined }}
          >
            {known ? taxon.name : "———"}
          </span>
          {found > 0 && total !== undefined && (
            <span className="num ml-auto text-[11px] text-muted">
              {found}/{total}
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="pl-1">
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
              open={open}
              toggle={toggle}
              openSpecies={openSpecies}
              setOpenSpecies={setOpenSpecies}
            />
          ))}
        </div>
      )}
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
  const color = colorOf(pack, species.id);
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
          style={{ background: known ? color : "var(--color-line)" }}
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
