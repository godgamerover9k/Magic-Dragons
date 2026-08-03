"use client";

import { useMemo, useState } from "react";
import { buildPool } from "@/game/breeding";
import { colorOf, formatDuration, formatNumber } from "@/game/economy";
import {
  nameOf,
  nestCapacityOf,
  nestsOf,
  nextNestCost,
  pairKey,
} from "@/game/engine";
import { HatchOverlay, type Hatched } from "./HatchOverlay";
import { taxonPath } from "@/game/taxonomy";
import { IV_MAX, type Dragon } from "@/game/types";
import type { Game } from "@/game/useGame";
import { Button, Empty, Panel, SectionHeading } from "./ui";

export function BreedTab({ game }: { game: Game }) {
  const { pack, save, now, act } = game;
  const [hatched, setHatched] = useState<Hatched | null>(null);
  const [sort, setSort] = useState<"name" | "iv" | "ivLow">("name");
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
  const hatch = async (nestId?: string) => {
    const before = new Set(save.dragons.map((d) => d.id));
    const wasKnown = new Set(save.discovered);
    const after = await act({ type: "hatch", nestId }, true);
    if (!after) return;
    const born = after.dragons.find((d) => !before.has(d.id));
    if (born) setHatched({ dragon: born, isNew: !wasKnown.has(born.speciesId) });
  };

  const picker = [...save.dragons].sort((x, y) => {
    if (sort === "iv") return (y.iv ?? 0) - (x.iv ?? 0);
    if (sort === "ivLow") return (x.iv ?? 0) - (y.iv ?? 0);
    return nameOf(pack, x).localeCompare(nameOf(pack, y));
  });

  const nests = nestsOf(save);
  const capacity = nestCapacityOf(pack, save);
  const full = nests.length >= capacity;
  const nestPrice = nextNestCost(pack, capacity);
  const canBuyNest = capacity < (pack.balance.maxNests ?? 1);

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

      {nests.length > 0 && (
        <>
          <SectionHeading label={`Nests · ${nests.length}/${capacity}`} />
          {nests.map((nest) => {
            const ready = now >= nest.readyAt;
            const pa = save.dragons.find((d) => d.id === nest.parentA);
            const pb = save.dragons.find((d) => d.id === nest.parentB);
            return (
              <Panel key={nest.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow truncate">
                      {pa ? nameOf(pack, pa) : "Unknown"} ×{" "}
                      {pb ? nameOf(pack, pb) : "Unknown"}
                    </p>
                    <p
                      className="num mt-1 text-sm"
                      style={{ color: ready ? "var(--color-verdigris)" : undefined }}
                    >
                      {ready ? "ready" : formatDuration(nest.readyAt - now)}
                    </p>
                  </div>
                  <Button variant="solid" disabled={!ready} onClick={() => hatch(nest.id)}>
                    Hatch
                  </Button>
                </div>
              </Panel>
            );
          })}
        </>
      )}

      <SectionHeading label="Pairing" />

      {full && (
        <p className="rounded border border-line bg-panel px-3 py-2 text-[11px] text-muted">
          Every nest is occupied. Hatch one, or buy another nest below.
        </p>
      )}

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
        <PastResults game={game} a={parentA.speciesId} b={parentB.speciesId} />
      )}

      <Button
        variant="solid"
        size="md"
        full
        disabled={!parentA || !parentB || full}
        onClick={() => {
          if (!parentA || !parentB) return;
          act({ type: "breed", parentA: parentA.id, parentB: parentB.id });
          setA(null);
          setB(null);
        }}
      >
        {full ? "Every nest is occupied" : "Breed"}
      </Button>

      {canBuyNest && (
        <Panel className="flex items-center justify-between gap-3 p-3">
          <div>
            <p className="text-sm">Keep another nest</p>
            <p className="text-xs text-muted">
              A second egg can sit alongside the first.{" "}
              <span className="num">{formatNumber(nestPrice)}</span> coins.
            </p>
          </div>
          <Button
            variant="solid"
            onClick={() => act({ type: "buyNest" })}
            disabled={save.coins < nestPrice}
          >
            Buy nest
          </Button>
        </Panel>
      )}

      <SectionHeading
        label="Choose from the roost"
        aside={
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="w-auto text-xs"
            aria-label="Sort dragons"
          >
            <option value="name">Name</option>
            <option value="iv">Highest IV</option>
            <option value="ivLow">Lowest IV</option>
          </select>
        }
      />
      {save.dragons.length < 2 ? (
        <Empty title="You need two dragons" body="Breeding takes a pair. Buy or hatch another first." />
      ) : (
        <div className="space-y-1.5">
          {picker.map((d) => {
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
                <span className="shrink-0 text-right">
                  <span className="num block text-xs text-muted">
                    T{d.tier} L{d.level}
                  </span>
                  <span className="num block text-[11px]" style={{ color: ivTint(d.iv) }}>
                    IV {d.iv}/{IV_MAX}
                  </span>
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
            <span className="num text-[11px]" style={{ color: ivTint(dragon.iv) }}>
              IV {dragon.iv}
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

/**
 * What this pairing has produced before, for this player. Nothing here is told
 * to them — it is only what they have already watched hatch, counted up. Two
 * keepers comparing notes is how a combo gets found.
 */
function PastResults({ game, a, b }: { game: Game; a: string; b: string }) {
  const { pack, save } = game;
  const row = save?.breedingLog?.[pairKey(a, b)];
  const entries = Object.entries(row ?? {})
    .filter(([id]) => pack.species[id])
    .sort((x, y) => y[1] - x[1]);
  const total = entries.reduce((n, [, count]) => n + count, 0);

  if (total === 0)
    return (
      <p className="rounded border border-line bg-panel px-3 py-2 text-[11px] text-muted">
        You have not bred this pair before. What comes of it is only known once the egg
        hatches.
      </p>
    );

  return (
    <Panel className="p-3">
      <p className="eyebrow mb-2">
        Bred {total} {total === 1 ? "time" : "times"} before
      </p>
      <ul className="space-y-1.5">
        {entries.map(([id, count]) => {
          const share = (count / total) * 100;
          return (
            <li key={id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate">{pack.species[id].name}</span>
                <span className="num shrink-0 text-xs text-muted">
                  {formatNumber(count)} · {share < 1 ? share.toFixed(1) : Math.round(share)}%
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${share}%`, background: colorOf(pack, id) }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
        Your own results only. A small number of tries says very little about the odds.
      </p>
    </Panel>
  );
}

/**
 * The two ends of the range are worth spotting at a glance — a pair of 31s or a
 * pair of 0s opens a rule nothing else does. Everything between reads as muted.
 */
function ivTint(iv: number): string | undefined {
  if (iv >= IV_MAX) return "var(--color-verdigris)";
  if (iv <= 0) return "var(--color-warn)";
  return "var(--color-muted)";
}
