"use client";

import { useState } from "react";
import {
  coinCap,
  coinsPerHour,
  eligibleFodder,
  formatNumber,
  formatDuration,
  hoursToFill,
  mergeCost,
  powerOf,
  tierOneCost,
  pendingCoins,
  rarityOf,
  speciesOf,
  timeUntilFull,
  xpToNextLevel,
} from "@/game/economy";
import {
  buyRoostSlot,
  feed,
  merge,
  nameOf,
  releaseDragon,
  updateDragon,
} from "@/game/engine";
import { nextRoostSlotCost } from "@/game/economy";
import { taxonPath } from "@/game/taxonomy";
import { IV_MAX } from "@/game/types";
import type { ContentPack, Dragon } from "@/game/types";
import type { Game } from "@/game/useGame";
import { Bar, Button, Empty, Panel, RarityChip, SectionHeading } from "./ui";

export function RoostTab({ game }: { game: Game }) {
  const { pack, save, now, act } = game;
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<"output" | "level" | "age" | "name">("output");
  if (!save) return null;

  const sorted = [...save.dragons].sort((a, b) => {
    if (sort === "output") return coinsPerHour(pack, b) - coinsPerHour(pack, a);
    if (sort === "level") return b.level - a.level || b.tier - a.tier;
    if (sort === "age") return a.bornAt - b.bornAt;
    return nameOf(pack, a).localeCompare(nameOf(pack, b));
  });

  const slotCost = nextRoostSlotCost(pack, save.roostCapacity);
  const totalRate = save.dragons.reduce((n, d) => n + coinsPerHour(pack, d), 0);

  return (
    <div className="space-y-3">
      <SectionHeading
        label={`Roost · ${save.dragons.length}/${save.roostCapacity} perches · ${formatNumber(totalRate)} coins/hr`}
        aside={
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="w-auto text-xs"
            aria-label="Sort dragons"
          >
            <option value="output">Output</option>
            <option value="level">Level</option>
            <option value="age">Oldest</option>
            <option value="name">Name</option>
          </select>
        }
      />

      {sorted.map((dragon) => (
        <DragonCard
          key={dragon.id}
          dragon={dragon}
          game={game}
          open={openId === dragon.id}
          onToggle={() => setOpenId(openId === dragon.id ? null : dragon.id)}
        />
      ))}

      <Panel className="flex items-center justify-between gap-3 p-3">
        <div>
          <p className="text-sm">Add a perch</p>
          <p className="text-xs text-muted">
            Room for one more dragon.{" "}
            <span className="num">{formatNumber(slotCost)}</span> coins.
          </p>
        </div>
        <Button
          variant="solid"
          onClick={() => act((s) => buyRoostSlot(pack, s))}
          disabled={save.coins < slotCost}
        >
          Buy perch
        </Button>
      </Panel>

      {save.dragons.length === 0 && (
        <Empty title="No dragons yet" body="Buy one in the Market to start the line." />
      )}

      <p className="px-1 text-[11px] text-muted">
        Coins bank for {pack.balance.coinStorageHours} hours, then stop. Collect from the
        bar above.
      </p>
    </div>
  );
}

function DragonCard({
  dragon,
  game,
  open,
  onToggle,
}: {
  dragon: Dragon;
  game: Game;
  open: boolean;
  onToggle: () => void;
}) {
  const { pack, save, now, act } = game;
  const species = speciesOf(pack, dragon);
  const rarity = rarityOf(pack, dragon);
  if (!save || !species) return null;

  const rate = coinsPerHour(pack, dragon);
  const banked = pendingCoins(pack, dragon, now);
  const cap = coinCap(pack, dragon);
  const need = xpToNextLevel(pack, dragon);
  const atMax = dragon.level >= pack.balance.maxLevel;
  const fillsIn = timeUntilFull(pack, dragon, now);
  const cost = mergeCost(pack, dragon);
  const fodder = eligibleFodder(save.dragons, dragon);
  const affordableFood = pack.balance.foodTypes;

  return (
    <Panel className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full p-3 text-left"
        aria-expanded={open}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-base leading-tight">
              {nameOf(pack, dragon)}
              {dragon.locked && <span className="ml-1.5 text-xs text-muted">locked</span>}
            </p>
            <p className="truncate text-[11px] text-muted">
              {dragon.nickname ? `${species.name} · ` : ""}
              {taxonPath(pack, species.taxonId)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="num text-sm" style={{ color: rarity?.color }}>
              T{dragon.tier} · L{dragon.level}
            </p>
            <p className="num text-[11px] text-muted">{formatNumber(rate)}/hr</p>
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <RarityChip rarity={rarity} />
          <span className="eyebrow">
            IV {dragon.iv}/{IV_MAX}
          </span>
          <span className="num ml-auto text-[11px] text-muted">
            {formatNumber(banked)}/{formatNumber(cap)} banked
          </span>
        </div>

        <div className="mt-2 space-y-1.5">
          <Bar value={banked} max={cap} color={rarity?.color} />
          {!atMax && <Bar value={dragon.xp} max={need} />}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-line p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <Stat label="Experience" value={atMax ? "max level" : `${formatNumber(dragon.xp)} / ${formatNumber(need)}`} />
            <Stat
              label="Storage"
              value={
                fillsIn === null
                  ? "full — not earning"
                  : `full in ${formatDuration(fillsIn)}`
              }
            />
            <Stat label="Power" value={formatNumber(powerOf(pack, dragon))} />
            <Stat
              label="Capacity"
              value={`${formatNumber(cap)} coins · ${hoursToFill(pack, dragon).toFixed(1)}h`}
            />
          </div>

          <IvPanel pack={pack} dragon={dragon} />

          {!atMax && affordableFood.length > 0 && (
            <div>
              <p className="eyebrow mb-1.5">Feed</p>
              <div className="flex flex-wrap gap-1.5">
                {affordableFood.map((f) => (
                  <Button
                    key={f.id}
                    onClick={() => act((s) => feed(pack, s, dragon.id, f.id, 1))}
                    disabled={save.food < f.foodCost}
                    title={`${f.foodCost} food → ${f.xp} xp`}
                  >
                    {f.name}
                    <span className="num text-muted">{f.foodCost}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="eyebrow mb-1.5">
              {cost === null
                ? "Max tier reached"
                : `Merge · needs ${cost} duplicates at tier ${dragon.tier} · have ${fodder.length}`}
            </p>
            {cost !== null && (
              <p className="mb-1.5 text-[11px] text-muted">
                A tier {dragon.tier + 1} is{" "}
                {formatNumber(tierOneCost(pack, species.rarityId, dragon.tier + 1))} tier 1
                dragons all told, since each step eats duplicates of the tier below.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="solid"
                onClick={() => act((s) => merge(pack, s, dragon.id))}
                disabled={cost === null || fodder.length < cost}
              >
                Merge to tier {dragon.tier + 1}
              </Button>
              <Button
                onClick={() =>
                  act((s) => updateDragon(s, dragon.id, { locked: !dragon.locked }), true)
                }
              >
                {dragon.locked ? "Unlock" : "Lock"}
              </Button>
              <Button
                variant="danger"
                onClick={() => act((s) => releaseDragon(pack, s, dragon.id))}
                disabled={dragon.locked}
              >
                Release
              </Button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow mb-1 block">Nickname</span>
              <input
                value={dragon.nickname ?? ""}
                placeholder={species.name}
                onChange={(e) =>
                  act(
                    (s) =>
                      updateDragon(s, dragon.id, {
                        nickname: e.target.value || null,
                      }),
                    true,
                  )
                }
              />
            </label>
            <label className="block">
              <span className="eyebrow mb-1 block">Notes</span>
              <input
                value={dragon.notes}
                placeholder="Anything worth remembering"
                onChange={(e) =>
                  act((s) => updateDragon(s, dragon.id, { notes: e.target.value }), true)
                }
              />
            </label>
          </div>

          <p className="text-[11px] text-muted">{species.description}</p>
        </div>
      )}
    </Panel>
  );
}

function IvPanel({ pack, dragon }: { pack: ContentPack; dragon: Dragon }) {
  const perfect = dragon.iv === IV_MAX;
  const share = dragon.iv / IV_MAX;
  const output = pack.iv.productionMagnitude * share;
  const growth = pack.iv.growthMagnitude * share;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="eyebrow">{pack.iv.name}</p>
        <p
          className="num text-sm"
          style={{ color: perfect ? "var(--color-verdigris)" : undefined }}
        >
          {dragon.iv}/{IV_MAX}
        </p>
      </div>
      <div className="mt-1">
        <Bar
          value={dragon.iv}
          max={IV_MAX}
          color={perfect ? "var(--color-verdigris)" : undefined}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        {output > 0 && `+${(output * 100).toFixed(1)}% coins`}
        {output > 0 && growth > 0 && " · "}
        {growth > 0 && `+${(growth * 100).toFixed(1)}% xp from food`}
        {output === 0 && growth === 0 && "No effect at the current settings."}
      </p>
      <p className="mt-0.5 text-[11px] text-muted">
        Rolled at birth and fixed for life. Nothing raises it.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-line/60 pb-1">
      <span className="text-muted">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}
