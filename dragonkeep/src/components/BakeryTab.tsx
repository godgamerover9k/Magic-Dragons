"use client";

import {
  bakeryTier,
  formatNumber,
  nextBakeryUpgrade,
  pendingFood,
} from "@/game/economy";
import { buildBakery, collectBakeries, upgradeBakery } from "@/game/engine";
import type { Game } from "@/game/useGame";
import { Bar, Button, Empty, Panel, SectionHeading } from "./ui";

export function BakeryTab({ game }: { game: Game }) {
  const { pack, save, now, act } = game;
  if (!save) return null;

  const nextCost = Math.round(
    bakeryTier(pack, 1).cost * Math.pow(pack.balance.bakeryCostGrowth, save.bakeries.length),
  );
  const canBuildMore = save.bakeries.length < pack.balance.maxBakeries;
  const totalPending = save.bakeries.reduce((n, b) => n + pendingFood(pack, b, now), 0);
  const bestLevel = Math.max(1, ...save.bakeries.map((b) => b.level));

  return (
    <div className="space-y-3">
      <SectionHeading
        label={`Bakeries · ${save.bakeries.length}/${pack.balance.maxBakeries}`}
        aside={
          <Button
            variant="solid"
            onClick={() => act((s) => collectBakeries(pack, s, Date.now()))}
            disabled={totalPending <= 0}
          >
            Collect {formatNumber(totalPending)} food
          </Button>
        }
      />

      {save.bakeries.length === 0 && (
        <Empty
          title="No ovens running"
          body="Bakeries turn coins into food, and food is the only way to raise a dragon's level."
        />
      )}

      {save.bakeries.map((bakery, i) => {
        const tier = bakeryTier(pack, bakery.level);
        const next = nextBakeryUpgrade(pack, bakery);
        const stored = pendingFood(pack, bakery, now);
        const full = stored >= tier.storage;
        return (
          <Panel key={bakery.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-base leading-tight">Bakery {i + 1}</p>
                <p className="num text-[11px] text-muted">
                  Level {bakery.level} · {tier.foodPerHour} food/hr
                </p>
              </div>
              <p className={`num text-sm ${full ? "text-warn" : "text-muted"}`}>
                {formatNumber(stored)}/{formatNumber(tier.storage)}
              </p>
            </div>
            <div className="mt-2">
              <Bar value={stored} max={tier.storage} color={full ? "var(--color-warn)" : undefined} />
            </div>
            {full && (
              <p className="mt-1.5 text-[11px] text-warn">
                Storage is full and baking has stopped. Collect to start it again.
              </p>
            )}
            <div className="mt-2.5">
              {next ? (
                <Button
                  onClick={() => act((s) => upgradeBakery(pack, s, bakery.id))}
                  disabled={save.coins < next.cost}
                >
                  Upgrade to level {next.level} ·{" "}
                  <span className="num">{formatNumber(next.cost)}</span> coins ·{" "}
                  {next.foodPerHour}/hr
                </Button>
              ) : (
                <p className="eyebrow">Fully upgraded</p>
              )}
            </div>
          </Panel>
        );
      })}

      {canBuildMore && (
        <Panel className="flex items-center justify-between gap-3 p-3">
          <div>
            <p className="text-sm">Build a bakery</p>
            <p className="text-xs text-muted">
              <span className="num">{formatNumber(nextCost)}</span> coins. Each one costs
              more than the last.
            </p>
          </div>
          <Button
            variant="solid"
            onClick={() => act((s) => buildBakery(pack, s, Date.now()))}
            disabled={save.coins < nextCost}
          >
            Build
          </Button>
        </Panel>
      )}

      <SectionHeading label="Recipes" />
      <Panel className="divide-y divide-line">
        {pack.balance.foodTypes.map((f) => {
          const locked = f.unlocksAtBakeryLevel > bestLevel;
          return (
            <div key={f.id} className={`flex items-center gap-3 p-3 ${locked ? "opacity-45" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{f.name}</p>
                <p className="text-[11px] text-muted">
                  {locked
                    ? `Needs a level ${f.unlocksAtBakeryLevel} bakery`
                    : `${(f.xp / f.foodCost).toFixed(1)} xp per food`}
                </p>
              </div>
              <p className="num shrink-0 text-xs text-muted">
                {f.foodCost} food → {formatNumber(f.xp)} xp
              </p>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
