import {
  buildBakery,
  buyRoostSlot,
  buySpecies,
  cancelBreeding,
  claimHatchling,
  collectAllBatches,
  collectAllCoins,
  collectBatch,
  feed,
  feedToNextLevel,
  grantDragon,
  merge,
  newGame,
  perchDragon,
  releaseDragon,
  setAdminMode,
  skipBaking,
  skipIncubation,
  startBatch,
  startBreeding,
  storeDragon,
  updateDragon,
  type ActionResult,
} from "./engine";
import { ensureViable } from "./engine";
import type { ContentPack, SaveGame } from "./types";

// ---------------------------------------------------------------------------
// Every change a player can make to their save is named here, and nowhere else.
//
// The same function runs in the browser (for local play, with no account) and
// on the server (for everyone signed in). Because both sides call into it, the
// rules cannot drift apart — a request the client would have refused is refused
// again on the server, against the state the server holds rather than the state
// the client claims to have.
// ---------------------------------------------------------------------------

export type Action =
  | { type: "collectCoins" }
  | { type: "feed"; dragonId: string; amount: number }
  | { type: "feedToNextLevel"; dragonId: string }
  | { type: "breed"; parentA: string; parentB: string }
  | { type: "hatch" }
  | { type: "cancelBreeding" }
  | { type: "merge"; dragonId: string }
  | { type: "buySpecies"; speciesId: string }
  | { type: "buyRoostSlot" }
  | { type: "buildBakery" }
  | { type: "startBatch"; bakeryId: string; batchId: string }
  | { type: "collectBatch"; bakeryId: string }
  | { type: "collectAllBatches" }
  | { type: "renameDragon"; dragonId: string; nickname: string | null }
  | { type: "noteDragon"; dragonId: string; notes: string }
  | { type: "lockDragon"; dragonId: string; locked: boolean }
  | { type: "perchDragon"; dragonId: string }
  | { type: "storeDragon"; dragonId: string }
  | { type: "releaseDragon"; dragonId: string }
  | { type: "restart" }
  // Admin only. The server refuses these outright for anyone else, so hiding
  // the tab is a convenience rather than the protection.
  | { type: "setAdminMode"; on: boolean }
  | { type: "grantDragon"; speciesId: string }
  | { type: "skipIncubation" }
  | { type: "skipBaking"; bakeryId: string }
  | { type: "addPerches"; count: number }
  | { type: "revealCodex" };

const ADMIN_ACTIONS: ReadonlySet<Action["type"]> = new Set([
  "setAdminMode",
  "grantDragon",
  "skipIncubation",
  "skipBaking",
  "addPerches",
  "revealCodex",
]);

export interface ActionContext {
  now: number;
  rng: () => number;
  /** Whether this player may run the designer-only actions. */
  isAdmin: boolean;
}

const fail = (save: SaveGame, message: string): ActionResult => ({
  save,
  ok: false,
  message,
});

/** Caps on free-text fields, so a save cannot be inflated through them. */
const NICKNAME_MAX = 40;
const NOTES_MAX = 500;

/**
 * Admin mode is stored in the save, which means it can outlive the account that
 * switched it on — a designer's save handed to a guest, say. It is therefore
 * treated as a claim rather than a fact: unless the caller is a designer right
 * now, the flag is cleared before anything reads it.
 */
export function withAdminChecked(save: SaveGame, isAdmin: boolean): SaveGame {
  if (isAdmin || !save.adminMode) return save;
  return { ...save, adminMode: false };
}

export function applyAction(
  pack: ContentPack,
  rawSave: SaveGame,
  action: Action,
  ctx: ActionContext,
): ActionResult {
  const save = ensureViable(pack, withAdminChecked(rawSave, ctx.isAdmin));

  if (ADMIN_ACTIONS.has(action.type) && !ctx.isAdmin)
    return fail(save, "That is not available on this account.");

  const { now, rng } = ctx;

  const done = (result: ActionResult): ActionResult =>
    result.ok ? { ...result, save: ensureViable(pack, result.save) } : result;

  switch (action.type) {
    case "collectCoins":
      return done(collectAllCoins(pack, save, now));

    case "feed":
      return done(feed(pack, save, action.dragonId, action.amount));

    case "feedToNextLevel":
      return done(feedToNextLevel(pack, save, action.dragonId));

    case "breed":
      return done(startBreeding(pack, save, action.parentA, action.parentB, now, rng));

    case "hatch":
      return done(claimHatchling(pack, save, now, rng));

    case "cancelBreeding":
      return done(cancelBreeding(save));

    case "merge":
      return done(merge(pack, save, action.dragonId));

    case "buySpecies":
      return done(buySpecies(pack, save, action.speciesId, now, rng));

    case "buyRoostSlot":
      return done(buyRoostSlot(pack, save));

    case "buildBakery":
      return done(buildBakery(pack, save, now));

    case "startBatch":
      return done(startBatch(pack, save, action.bakeryId, action.batchId, now));

    case "collectBatch":
      return done(collectBatch(pack, save, action.bakeryId, now));

    case "collectAllBatches":
      return done(collectAllBatches(pack, save, now));

    case "renameDragon": {
      const nickname = action.nickname?.slice(0, NICKNAME_MAX).trim() || null;
      return updateDragon(save, action.dragonId, { nickname });
    }

    case "noteDragon":
      return updateDragon(save, action.dragonId, {
        notes: String(action.notes ?? "").slice(0, NOTES_MAX),
      });

    case "lockDragon":
      return updateDragon(save, action.dragonId, { locked: Boolean(action.locked) });

    case "perchDragon":
      return done(perchDragon(save, action.dragonId));

    case "storeDragon":
      return done(storeDragon(save, action.dragonId));

    case "releaseDragon":
      return done(releaseDragon(pack, save, action.dragonId));

    case "restart":
      return { save: newGame(pack, now), ok: true, message: "New keeper started." };

    // --- Admin ---------------------------------------------------------------

    case "setAdminMode":
      return done(setAdminMode(save, action.on));

    case "grantDragon":
      return done(grantDragon(pack, save, action.speciesId, now));

    case "skipIncubation":
      return done(skipIncubation(save, now));

    case "skipBaking":
      return done(skipBaking(save, action.bakeryId, now));

    case "addPerches": {
      const count = Math.min(Math.max(Math.floor(action.count), 1), 100);
      return {
        save: { ...save, roostCapacity: save.roostCapacity + count },
        ok: true,
        message: `Roost expanded to ${save.roostCapacity + count} perches.`,
      };
    }

    case "revealCodex":
      return {
        save: { ...save, discovered: Object.keys(pack.species) },
        ok: true,
        message: "Codex revealed.",
      };

    default: {
      // Exhaustiveness: adding a case above without handling it fails the build.
      const unreachable: never = action;
      return fail(save, `Unknown action: ${JSON.stringify(unreachable)}`);
    }
  }
}
