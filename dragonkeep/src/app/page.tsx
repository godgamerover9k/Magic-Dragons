"use client";

import { useState } from "react";
import { AccountTab } from "@/components/AccountTab";
import { AdminTab } from "@/components/AdminTab";
import { BakeryTab } from "@/components/BakeryTab";
import { BreedTab } from "@/components/BreedTab";
import { CodexTab } from "@/components/CodexTab";
import { MarketTab } from "@/components/MarketTab";
import { RoostTab } from "@/components/RoostTab";
import { Button } from "@/components/ui";
import { formatNumber, pendingCoins, readyFood } from "@/game/economy";
import { collectAllCoins } from "@/game/engine";
import { useGame } from "@/game/useGame";

const TABS = ["Roost", "Breed", "Bakery", "Market", "Codex", "Account", "Admin"] as const;
type Tab = (typeof TABS)[number];

export default function Page() {
  const game = useGame();
  const [tab, setTab] = useState<Tab>("Roost");
  const { pack, save, now, ready, toasts, act } = game;

  if (!ready || !save) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="eyebrow">Opening the register...</p>
      </main>
    );
  }

  const banked = save.dragons.reduce((n, d) => n + pendingCoins(pack, d, now), 0);
  const foodWaiting = readyFood(pack, save, now);

  return (
    <main className="mx-auto min-h-dvh max-w-2xl overflow-x-hidden pb-24">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/95 backdrop-blur">
        <div className="flex items-baseline gap-2 px-4 pt-3">
          <h1 className="shrink-0 font-display text-lg leading-none tracking-tight">
            Dragonkeep
          </h1>
          <p className="eyebrow min-w-0 truncate">{pack.name}</p>
        </div>

        <div className="flex items-center gap-4 px-4 py-2.5">
          <div>
            <p className="eyebrow">Coins</p>
            <p className="num text-base leading-tight">
              {save.adminMode ? "∞" : formatNumber(save.coins)}
            </p>
          </div>
          <div>
            <p className="eyebrow">Food</p>
            <p className="num text-base leading-tight">
              {save.adminMode ? "∞" : formatNumber(save.food)}
              {foodWaiting > 0 && (
                <span className="ml-1 text-xs text-verdigris">
                  +{formatNumber(foodWaiting)}
                </span>
              )}
            </p>
          </div>
          <div className="ml-auto">
            <Button
              variant="solid"
              size="md"
              disabled={banked <= 0}
              onClick={() => act((s) => collectAllCoins(pack, s, Date.now()))}
            >
              Collect {formatNumber(banked)}
            </Button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`shrink-0 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t
                  ? "bg-verdigris/15 text-verdigris"
                  : "text-muted hover:text-bone"
              }`}
              aria-current={tab === t ? "page" : undefined}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>

      <div className="px-4 pt-4">
        {tab === "Roost" && <RoostTab game={game} />}
        {tab === "Breed" && <BreedTab game={game} />}
        {tab === "Bakery" && <BakeryTab game={game} />}
        {tab === "Market" && <MarketTab game={game} />}
        {tab === "Codex" && <CodexTab game={game} />}
        {tab === "Account" && <AccountTab game={game} />}
        {tab === "Admin" && <AdminTab game={game} />}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex flex-col items-center gap-1.5 px-4">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            className={`max-w-md rounded-full border px-4 py-2 text-center text-xs backdrop-blur ${
              toast.ok
                ? "border-verdigris/50 bg-verdigris/15 text-verdigris"
                : "border-warn/50 bg-warn/15 text-warn"
            }`}
          >
            {toast.text}
          </p>
        ))}
      </div>
    </main>
  );
}
