import packJson from "./pack.json";
import type { ContentPack } from "./types";

// SERVER ONLY. Importing this anywhere the browser can reach puts every dragon,
// branch and breeding weight into the shipped bundle. The client gets its pack
// from /api/game instead, already filtered to what has been unlocked.

// ---------------------------------------------------------------------------
// The shipped content lives in pack.json, not in this file.
//
// To change what dragons exist: design it in Admin, press "Download content
// pack", raise the version number, and replace src/game/pack.json with the
// file you downloaded. No TypeScript to edit.
//
// Raising `version` is what pushes the change to people who have already
// played — see loadPack in storage.ts.
// ---------------------------------------------------------------------------

export { SCHEMA_VERSION } from "./schema";

const shipped = packJson as unknown as ContentPack;

/** A fresh copy every time, so nothing can mutate the shipped pack in place. */
export function defaultContentPack(): ContentPack {
  return structuredClone(shipped);
}

/** The version currently shipped in the repo. */
export const SHIPPED_VERSION = shipped.version ?? 1;
