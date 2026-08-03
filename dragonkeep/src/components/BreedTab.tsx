"use client";

import { useMemo, useState } from "react";
import { buildPool } from "@/game/breeding";
import { colorOf, formatDuration } from "@/game/economy";
import { nameOf } from "@/game/engine";
import { HatchOverlay, type Hatched } from "./HatchOverlay";
import { taxonPath } from "@/game/taxonomy";
import type { Dragon } from "@/game/types";
import type { Game } from "@/game/useGame";
import { Button, Empty, Panel, SectionHeading } from "./ui";

export function BreedTab({ game }: { game: Game }) {
  const { pack, save, now, act } = game;
  const [hatched, setHatched] = useState<Hatched | null>(null);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);

  const parentA = save?.dragons.find((d) => d.id === a) ?? null;
  const parentB = save?.dragons.find((d) => d.id === b) ?? null;

  const pool = useMemo(() => {
    if (!save || !parentA || !parentB) return null;
    if (!pack.species[parentA.speciesId] || !pack.species[parentB.speciesId]) return null;
    return buildPool(pack, parentA, parentB);
  }, [pack, save, parentA, parentB]);

  if (!save) return null;

  /**
   * Hatching is handled here rather than through `act` so the new dragon can be
   * picked out of the result and shown before it disappears into the roost.
   */
  const hatch = async () => {
    const before = new Set(save.dragons.map((d) => d.id));
    const wasKnown = new Set(save.discovered);
    const after = await act({ type: "hatch" }, true);
    if (!after) return;
    const born = after.dragons.find((d) => !before.has(d.id));
    if (born) setHatched({ dragon: born, isNew: !wasKnown.has(born.speciesId) });
  };

  const nest = save.breeding;
  if (nest) {
    const ready = now >= nest.readyAt;
    const pa = save.dragons.find((d) => d.id === nest.parentA);
    const pb = save.dragons.find((d) => d.id === nest.parentB);
    return (
      <div className="space-y-3">
        {hatched && (
          <HatchOverlay
            pack={pack}
            hatched={hatched}
            onClose={() => setHatched(null)}
          />
        )}
        <SectionHeading label="Nest" />
        <Panel className="p-4 text-center">
          <p className="eyebrow">
            {pa ? nameOf(pack, pa) : "Unknown"} × {pb ? nameOf(pack, pb) : "Unknown"}
          </p>
          <p className="mt-2 font-display text-2xl">
            {ready ? "The egg is ready" : formatDuration(nest.readyAt - now)}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
            {ready
              ? "What is inside was decided when the pair nested."
              : "The result is already sealed. Waiting will not change it."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button
              variant="solid"
              size="md"
              disabled={!ready}
              onClick={hatch}
            >
              Hatch
            </Button>
            <Button size="md" variant="danger" onClick={() => act({ type: "cancelBreeding" })}>
              Abandon
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  const pick = (id: string) => {
    if (a === id) return setA(null);
    if (b === id) return setB(null);
    if (!a) return setA(id);
    if (!b) return setB(id);
    setA(b);
    setB(id);
  };

  return (
    <div className="space-y-3">
      {hatched && (
        <HatchOverlay
          pack={pack}
          hatched={hatched}
          onClose={() => setHatched(null)}
        />
      )}

      <SectionHeading label="Pairing" />

      <div className="grid grid-cols-2 gap-2">
        <Slot label="First parent" dragon={parentA} game={game} onClear={() => setA(null)} />
        <Slot label="Second parent" dragon={parentB} game={game} onClear={() => setB(null)} />
      </div>

      {pool && save.adminMode && (
        <Panel className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Possible outcomes · {pool.entries.length}</p>
            <span className="eyebrow text-verdigris">admin only</span>
          </div>
          <ul className="space-y-1.5">
            {pool.entries.map((entry) => {
              const species = pack.species[entry.speciesId];
              if (!species) return null;
              const pct = (entry.weight / pool.totalWeight) * 100;
              return (
                <li key={entry.speciesId} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: colorOf(pack, species.id) }}
                  />
                  <span className="truncate">{species.name}</span>
                  <span className="truncate text-[11px] text-muted">
                    {entry.sources.join(", ")}
                  </span>
                  <span className="num ml-auto shrink-0 text-xs text-muted">
                    {pct < 1 ? pct.toFixed(1) : Math.round(pct)}%
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {parentA && parentB && !save.adminMode && (
        <p className="rounded border border-line bg-panel px-3 py-2 text-[11px] text-muted">
          What comes of a pairing is only known once the egg hatches.
        </p>
      )}

      <Button
        variant="solid"
        size="md"
        full
        disabled={!parentA || !parentB || save.dragons.length >= save.roostCapacity}
        onClick={() => {
          if (!parentA || !parentB) return;
          act({ type: "breed", parentA: parentA.id, parentB: parentB.id });
          setA(null);
          setB(null);
        }}
      >
        {save.dragons.length >= save.roostCapacity ? "Roost is full" : "Breed"}
      </Button>

      <SectionHeading label="Choose from the roost" />
      {save.dragons.length < 2 ? (
        <Empty title="You need two dragons" body="Breeding takes a pair. Buy or hatch another first." />
      ) : (
        <div className="space-y-1.5">
          {save.dragons.map((d) => {
            const selected = d.id === a || d.id === b;
            const species = pack.species[d.speciesId];
            if (!species) return null;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => pick(d.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  selected ? "border-verdigris bg-verdigris/10" : "border-line bg-panel"
                }`}
              >
                <span
                  className="h-6 w-0.5 shrink-0 rounded"
                  style={{ background: colorOf(pack, d.speciesId) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{nameOf(pack, d)}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {taxonPath(pack, species.taxonId)}
                  </span>
                </span>
                <span className="num shrink-0 text-xs text-muted">
                  T{d.tier} L{d.level}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Slot({
  label,
  dragon,
  game,
  onClear,
}: {
  label: string;
  dragon: Dragon | null;
  game: Game;
  onClear: () => void;
}) {
  const { pack } = game;
  return (
    <Panel className="p-3">
      <p className="eyebrow">{label}</p>
      {dragon ? (
        <>
          <p className="mt-1 truncate font-display text-sm">{nameOf(pack, dragon)}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="eyebrow" style={{ color: colorOf(pack, dragon.speciesId) }}>{pack.species[dragon.speciesId]?.name}</span>
            <span className="num text-[11px] text-muted">
              T{dragon.tier} L{dragon.level}
            </span>
          </div>
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">Pick one below</p>
      )}
    </Panel>
  );
}
