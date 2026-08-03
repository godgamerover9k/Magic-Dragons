"use client";

import {
  colorOf,
  formatDuration,
  formatNumber,
  marketCooldownLeft,
} from "@/game/economy";
import { taxonPath } from "@/game/taxonomy";
import type { Game } from "@/game/useGame";
import { Button, Empty, Panel, SectionHeading } from "./ui";

export function MarketTab({ game }: { game: Game }) {
  const { pack, save, now, act } = game;
  if (!save) return null;

  const forSale = Object.values(pack.species)
    .filter((s) => s.marketPrice && s.marketPrice > 0 && s.obtainable)
    .sort((a, b) => (a.marketPrice ?? 0) - (b.marketPrice ?? 0));


  return (
    <div className="space-y-3">
      <SectionHeading label="Market" />

      <p className="px-1 text-[11px] text-muted">
        Each dragon can be bought twice a day. With every perch taken, a purchase goes to
        storage rather than being refused.
      </p>

      {forSale.length === 0 && (
        <Empty
          title="Nothing for sale"
          body="Give a species a market price in Admin to stock the market."
        />
      )}

      {forSale.map((species) => {

        const owned = save.dragons.filter((d) => d.speciesId === species.id).length;
        const wait = save.adminMode ? 0 : marketCooldownLeft(pack, save, species.id, now);
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
            {species.description && (
              <p className="mt-2 text-xs text-muted">{species.description}</p>
            )}
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <p className="num text-[11px] text-muted">
                {species.baseProduction} base coins/hr
                {owned > 0 && ` · you own ${owned}`}
              </p>
              <Button
                variant="solid"
                onClick={() => act({ type: "buySpecies", speciesId: species.id })}
                disabled={wait > 0 || save.coins < (species.marketPrice ?? 0)}
              >
                {wait > 0 ? (
                  <>Back in {formatDuration(wait)}</>
                ) : (
                  <>
                    Buy · <span className="num">{formatNumber(species.marketPrice ?? 0)}</span>
                  </>
                )}
              </Button>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
