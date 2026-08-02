"use client";

import { useEffect, useMemo, useState } from "react";
import { coinsPerHour, colorOf, formatNumber } from "@/game/economy";
import { taxonPath } from "@/game/taxonomy";
import { IV_MAX, type ContentPack, type Dragon } from "@/game/types";
import { Bar, Button } from "./ui";

export interface Hatched {
  dragon: Dragon;
  isNew: boolean;
}

// Hatching is the only moment a player learns what a pairing produced, since the
// odds are hidden during play. A known dragon shows everything at once and gets
// out of the way; one new to the codex is revealed in stages. Confetti marks a
// first, a shine marks a flawless roll, and both can happen at once.

export function HatchOverlay({
  pack,
  hatched,
  onClose,
}: {
  pack: ContentPack;
  hatched: Hatched;
  onClose: () => void;
}) {
  const { dragon, isNew } = hatched;
  const species = pack.species[dragon.speciesId];
  const flawless = (dragon.iv ?? 0) >= IV_MAX;
  const color = colorOf(pack, dragon.speciesId);

  // 0 = the egg, 1 = the name, 2 = everything. A familiar dragon skips straight
  // to the end; there is nothing to draw out.
  const [stage, setStage] = useState(isNew ? 0 : 2);

  useEffect(() => {
    if (!isNew) return;
    const timers = [
      setTimeout(() => setStage(1), 900),
      setTimeout(() => setStage(2), 1900),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isNew]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!species) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? "A dragon new to the codex has hatched" : "A dragon has hatched"}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-ink/95 px-6 backdrop-blur-sm"
      onClick={stage === 2 ? onClose : undefined}
    >
      {isNew && stage >= 1 && <Confetti color={color} seed={dragon.id} />}

      <div className="relative w-full max-w-sm text-center">
        {stage === 0 ? (
          <div className="py-16">
            <div
              className="hatch-pulse mx-auto h-20 w-16 rounded-[50%_50%_45%_45%/60%_60%_40%_40%]"
              style={{ background: color, opacity: 0.6 }}
            />
            <p className="eyebrow mt-6">the egg is opening</p>
          </div>
        ) : (
          <div className="hatch-in">
            {isNew && (
              <p className="eyebrow mb-2" style={{ color }}>
                new to the codex
              </p>
            )}

            <div
              className={`rounded-lg border p-5 ${flawless ? "shine" : ""}`}
              style={{
                borderColor: flawless ? color : "var(--color-line)",
                background: `linear-gradient(180deg, ${color}1f, transparent 70%)`,
              }}
            >
              <h2 className="font-display text-2xl leading-tight" style={{ color }}>
                {species.name}
              </h2>
              <p className="mt-1 text-[11px] text-muted">
                {taxonPath(pack, species.taxonId)}
              </p>

              {stage >= 2 && (
                <div className="hatch-in mt-5 space-y-3 text-left">
                  {flawless && (
                    <p
                      className="eyebrow text-center"
                      style={{ color: "var(--color-verdigris)" }}
                    >
                      flawless — a perfect {IV_MAX}
                    </p>
                  )}

                  <div>
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="text-muted">{pack.iv.name}</span>
                      <span
                        className="num"
                        style={{ color: flawless ? "var(--color-verdigris)" : undefined }}
                      >
                        {dragon.iv}/{IV_MAX}
                      </span>
                    </div>
                    <div className="mt-1">
                      <Bar
                        value={dragon.iv ?? 0}
                        max={IV_MAX}
                        color={flawless ? "var(--color-verdigris)" : color}
                      />
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted">Output</span>
                    <span className="num">
                      {formatNumber(coinsPerHour(pack, dragon))} coins/hr
                    </span>
                  </div>

                  {species.description && (
                    <p className="border-t border-line pt-3 text-[11px] leading-snug text-muted">
                      {species.description}
                    </p>
                  )}
                </div>
              )}
            </div>

            {stage >= 2 && (
              <div className="hatch-in mt-5">
                <Button variant="solid" size="md" onClick={onClose}>
                  To the roost
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Deterministic scatter. The pieces are derived from the dragon's own id rather
 * than Math.random, so the layout is stable across re-renders and identical on
 * server and client — no flicker, no restarted fall.
 */
function scatter(seed: string, color: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
  return Array.from({ length: 42 }, (_, i) => ({
    id: i,
    left: next() * 100,
    delay: next() * 1.4,
    duration: 2.4 + next() * 1.8,
    tint: [color, "var(--color-verdigris)", "var(--color-bone)"][i % 3],
    tilt: next() * 60 - 30,
  }));
}

function Confetti({ color, seed }: { color: string; seed: string }) {
  const pieces = useMemo(() => scatter(seed, color), [seed, color]);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti"
          style={{
            left: `${p.left}%`,
            background: p.tint,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            rotate: `${p.tilt}deg`,
          }}
        />
      ))}
    </div>
  );
}
