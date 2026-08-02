"use client";

import {
  batchById,
  formatDuration,
  formatNumber,
  nextBakeryCost,
  ovenState,
  readyFood,
} from "@/game/economy";
import {
  buildBakery,
  canAfford,
  collectAllBatches,
  collectBatch,
  skipBaking,
  startBatch,
} from "@/game/engine";
import type { Bakery } from "@/game/types";
import type { Game } from "@/game/useGame";
import { Bar, Button, Empty, Panel, SectionHeading } from "./ui";

export function BakeryTab({ game }: { game: Game }) {
  const { pack, save, now, act } = game;
  if (!save) return null;

  const waiting = readyFood(pack, save, now);
  const cost = nextBakeryCost(pack, save.bakeries.length);
  const canBuildMore = save.bakeries.length < pack.balance.maxBakeries || save.adminMode;

  return (
    <div className="space-y-3">
      <SectionHeading
        label={`Bakeries · ${save.bakeries.length}/${pack.balance.maxBakeries}`}
        aside={
          <Button
            variant="solid"
            onClick={() => act((s) => collectAllBatches(pack, s, Date.now()))}
            disabled={waiting <= 0}
          >
            Collect {formatNumber(waiting)} food
          </Button>
        }
      />

      {save.bakeries.length === 0 && (
        <Empty
          title="No ovens yet"
          body="An oven bakes what you tell it to. Food is the only way to raise a dragon's level."
        />
      )}

      {save.bakeries.map((oven, i) => (
        <Oven key={oven.id} oven={oven} index={i} game={game} />
      ))}

      {canBuildMore && (
        <Panel className="flex items-center justify-between gap-3 p-3">
          <div>
            <p className="text-sm">Build an oven</p>
            <p className="text-xs text-muted">
              <span className="num">{formatNumber(cost)}</span> coins. A second oven bakes
              alongside the first.
            </p>
          </div>
          <Button
            variant="solid"
            onClick={() => act((s) => buildBakery(pack, s, Date.now()))}
            disabled={!canAfford(save, cost)}
          >
            Build
          </Button>
        </Panel>
      )}

      <p className="px-1 text-[11px] text-muted">
        Ovens only run when you give them something to make. Bigger orders cost more and
        take longer, but pay far better per minute.
      </p>
    </div>
  );
}

function Oven({ oven, index, game }: { oven: Bakery; index: number; game: Game }) {
  const { pack, save, now, act } = game;
  if (!save) return null;

  const state = ovenState(oven, now);
  const batch = batchById(pack, oven.batchId);

  if (state === "idle") {
    return (
      <Panel className="p-3">
        <p className="font-display text-base leading-tight">Oven {index + 1}</p>
        <p className="eyebrow mt-0.5">Idle — choose an order</p>
        <div className="mt-2.5 space-y-1.5">
          {pack.balance.foodBatches.map((option) => {
            const affordable = canAfford(save, option.coinCost);
            const perMinute = option.food / (option.seconds / 60);
            return (
              <button
                key={option.id}
                type="button"
                disabled={!affordable}
                onClick={() =>
                  act((s) => startBatch(pack, s, oven.id, option.id, Date.now()))
                }
                className="flex w-full items-center gap-3 rounded border border-line px-3 py-2 text-left transition-colors enabled:hover:border-verdigris disabled:opacity-35"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{option.name}</span>
                  <span className="num block text-[11px] text-muted">
                    {option.coinCost === 0
                      ? "free"
                      : `${formatNumber(option.coinCost)} coins`}{" "}
                    · {formatDuration(option.seconds * 1000)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="num block text-sm text-verdigris">
                    +{formatNumber(option.food)}
                  </span>
                  <span className="num block text-[10px] text-muted">
                    {perMinute.toFixed(1)}/min
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Panel>
    );
  }

  const total = batch ? batch.seconds * 1000 : 1;
  const done = Math.min(now - oven.startedAt, total);

  return (
    <Panel className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-base leading-tight">Oven {index + 1}</p>
          <p className="eyebrow mt-0.5">{batch?.name ?? "Unknown order"}</p>
        </div>
        <p className="num text-sm" style={{ color: state === "ready" ? "var(--color-verdigris)" : undefined }}>
          {state === "ready" ? "ready" : formatDuration(oven.readyAt - now)}
        </p>
      </div>

      <div className="mt-2">
        <Bar value={done} max={total} />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button
          variant="solid"
          disabled={state !== "ready"}
          onClick={() => act((s) => collectBatch(pack, s, oven.id, Date.now()))}
        >
          Collect {formatNumber(batch?.food ?? 0)} food
        </Button>
        {save.adminMode && state === "baking" && (
          <Button onClick={() => act((s) => skipBaking(s, oven.id, Date.now()))}>
            Skip wait
          </Button>
        )}
      </div>
    </Panel>
  );
}
