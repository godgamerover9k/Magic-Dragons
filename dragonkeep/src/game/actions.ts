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
  releaseDragon,
  setAdminMode,
  skipBaking,
  skipIncubation,
  startBatch,
  startBreeding,
  updateDragon,
  type ActionResult,
} from "./engine";
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

export function applyAction(
  pack: ContentPack,
  save: SaveGame,
  action: Action,
  ctx: ActionContext,
): ActionResult {
  if (ADMIN_ACTIONS.has(action.type) && !ctx.isAdmin)
    return fail(save, "That is not available on this account.");

  const { now, rng } = ctx;

  switch (action.type) {
    case "collectCoins":
      return collectAllCoins(pack, save, now);

    case "feed":
      return feed(pack, save, action.dragonId, action.amount);

    case "feedToNextLevel":
      return feedToNextLevel(pack, save, action.dragonId);

    case "breed":
      return startBreeding(pack, save, action.parentA, action.parentB, now, rng);

    case "hatch":
      return claimHatchling(pack, save, now, rng);

    case "cancelBreeding":
      return cancelBreeding(save);

    case "merge":
      return merge(pack, save, action.dragonId);

    case "buySpecies":
      return buySpecies(pack, save, action.speciesId, now, rng);

    case "buyRoostSlot":
      return buyRoostSlot(pack, save);

    case "buildBakery":
      return buildBakery(pack, save, now);

    case "startBatch":
      return startBatch(pack, save, action.bakeryId, action.batchId, now);

    case "collectBatch":
      return collectBatch(pack, save, action.bakeryId, now);

    case "collectAllBatches":
      return collectAllBatches(pack, save, now);

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

    case "releaseDragon":
      return releaseDragon(pack, save, action.dragonId);

    case "restart":
      return { save: newGame(pack, now), ok: true, message: "New keeper started." };

    // --- Admin ---------------------------------------------------------------

    case "setAdminMode":
      return setAdminMode(save, action.on);

    case "grantDragon":
      return grantDragon(pack, save, action.speciesId, now);

    case "skipIncubation":
      return skipIncubation(save, now);

    case "skipBaking":
      return skipBaking(save, action.bakeryId, now);

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
