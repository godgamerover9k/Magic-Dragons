"use client";

import { colorOf, formatDuration, formatNumber, incubationSeconds } from "@/game/economy";
import { taxonPath } from "@/game/taxonomy";
import type { Game } from "@/game/useGame";
import { Button, Empty, Panel, SectionHeading } from "./ui";

export function MarketTab({ game }: { game: Game }) {
  const { pack, save, act } = game;
  if (!save) return null;

  const forSale = Object.values(pack.species)
    .filter((s) => s.marketPrice && s.marketPrice > 0 && s.obtainable)
    .sort((a, b) => (a.marketPrice ?? 0) - (b.marketPrice ?? 0));

  const full = save.dragons.length >= save.roostCapacity;

  return (
    <div className="space-y-3">
      <SectionHeading label="Market" />

      {full && (
        <p className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          The roost is full. Add a perch or release a dragon before buying.
        </p>
      )}

      {forSale.length === 0 && (
        <Empty
          title="Nothing for sale"
          body="Give a species a market price in Admin to stock the market."
        />
      )}

      {forSale.map((species) => {

        const owned = save.dragons.filter((d) => d.speciesId === species.id).length;
        return (
          <Panel key={species.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-base leading-tight">{species.name}</p>
                <p className="truncate text-[11px] text-muted">
                  {taxonPath(pack, species.taxonId)}
                </p>
              </div>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf(pack, species.id) }} />
            </div>
            <p className="mt-2 text-xs text-muted">{species.description}</p>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className="num text-[11px] text-muted">
                {species.baseProduction} base coins/hr ·{" "}
                {formatDuration(incubationSeconds(pack, species.id) * 1000)} to hatch
                {owned > 0 && ` · you own ${owned}`}
              </p>
              <Button
                variant="solid"
                onClick={() => act({ type: "buySpecies", speciesId: species.id })}
                disabled={full || save.coins < (species.marketPrice ?? 0)}
              >
                Buy · <span className="num">{formatNumber(species.marketPrice ?? 0)}</span>
              </Button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
