"use client";

import { useState } from "react";

import {
  batchById,
  formatDuration,
  formatNumber,
  nextBakeryCost,
  ovenState,
  readyFood,
} from "@/game/economy";
import {
  canAfford,
} from "@/game/engine";
import type { Bakery } from "@/game/types";
import type { Game } from "@/game/useGame";
import { Bar, Button, Empty, Field, Panel, SectionHeading } from "./ui";

export function BakeryTab({ game }: { game: Game }) {
  const { pack, save, now, act } = game;
  if (!save) return null;

  const waiting = readyFood(pack, save, now);
  const cost = nextBakeryCost(pack, save.bakeries.length);
  const canBuildMore = save.bakeries.length < pack.balance.maxBakeries || save.adminMode;

  return (
    <div className="space-y-3">
      <SectionHeading
        label={`Bakeries ${save.bakeries.length}/${pack.balance.maxBakeries}`}
        aside={
          <Button
            variant="solid"
            onClick={() => act({ type: "collectAllBatches" })}
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
            onClick={() => act({ type: "buildBakery" })}
            disabled={!canAfford(save, cost)}
          >
            Build
          </Button>
        </Panel>
      )}

      <p className="px-1 text-[11px] text-muted">
        Ovens only run when you give them something to make. Bigger orders cost more and
        take longer, but pay far better per minute. All food goes to one pile — spend it
        on whichever dragons you like.
      </p>
    </div>
  );
}

function Oven({ oven, index, game }: { oven: Bakery; index: number; game: Game }) {
  const { pack, save, now, act } = game;
  const [selected, setSelected] = useState(pack.balance.foodBatches[0]?.id ?? "");
  if (!save) return null;

  const state = ovenState(oven, now);
  const batch = batchById(pack, oven.batchId);

  if (state === "idle") {
    const chosen = batchById(pack, selected) ?? pack.balance.foodBatches[0] ?? null;
    const affordable = chosen ? canAfford(save, chosen.coinCost) : false;

    return (
      <Panel className="p-3">
        <p className="font-display text-base leading-tight">Oven {index + 1}</p>
        <p className="eyebrow mt-0.5">Idle</p>

        <div className="mt-2.5">
          <Field label="Order">
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {pack.balance.foodBatches.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} — {option.coinCost === 0 ? "free" : `${formatNumber(option.coinCost)} coins`}
                  {" · "}
                  {formatDuration(option.seconds * 1000)} · +{formatNumber(option.food)} food
                </option>
              ))}
            </select>
          </Field>
        </div>

        {chosen && (
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="num text-[11px] text-muted">
              {(chosen.food / (chosen.seconds / 60)).toFixed(1)} food per minute
            </p>
            <Button
              variant="solid"
              disabled={!affordable}
              onClick={() => act({ type: "startBatch", bakeryId: oven.id, batchId: chosen.id })}
            >
              {affordable ? "Start baking" : "Not enough coins"}
            </Button>
          </div>
        )}
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
          onClick={() => act({ type: "collectBatch", bakeryId: oven.id })}
        >
          Collect {formatNumber(batch?.food ?? 0)} food
        </Button>
        {save.adminMode && state === "baking" && (
          <Button onClick={() => act({ type: "skipBaking", bakeryId: oven.id })}>
            Skip wait
          </Button>
        )}
      </div>
    </Panel>
  );
}
