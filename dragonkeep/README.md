# Dragonkeep

**The content is deliberately placeholder.** Five dragons named Placeholder 1-5,
a generic taxonomy, and one breeding rule of each kind. They exist so every
system has something to stand on and so the shape of each rule is visible.
Replace all of it in Admin.

A text-based dragon collecting game. Next.js App Router, deployable to Vercel as-is.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run check    # engine self-tests (37 checks)
npm run build    # production build
```

## Deploying to Vercel

1. Push this folder to a GitHub repository.
2. At vercel.com, choose **Add New -> Project** and pick that repository.
3. Accept every default and press Deploy. There is nothing to configure.

Without Supabase keys the game plays fine and saves to the browser. Add the keys
and accounts switch on. See *Accounts* below.

## Adding a dragon (no code)

Open the **Admin** tab in the running game.

1. **Taxonomy** - add the branch it belongs to, if it needs a new one. The tree is
   any depth you like; a branch can sit inside a branch inside a branch.
2. **Dragons -> Add a new dragon** - name, branch, rarity, base coins per hour,
   codex text, and any tags.
3. **Breeding rules** - add outcomes so it can actually be bred, or give it a
   market price so it can be bought. The validator warns you if a dragon has no
   way of being obtained.
4. **Files -> Download content pack** - this is your backup. Browser storage is
   not one.

To ship your changes to everyone: replace `src/game/content.ts` with the
downloaded JSON, or load the pack file at runtime.

## How breeding works

One breed builds one weighted pool:

- Both parents enter the pool at `parentWeight` (default 50 each).
- Every rule that matches the pair adds its outcomes to the same pool.
- Duplicate species have their weights summed.
- One roll against the total picks the result.

So the default result is always one of the parents, and combos are just extra
weight on top. Three ways to match a pair, all usable in one rule:

| Matcher | Fires when |
|---|---|
| A specific dragon | That exact species is a parent |
| Anything in a branch | The parent sits anywhere under that taxon |
| Anything with a tag | The parent carries that tag |

Rules match in either order. A rule marked **guaranteed** throws away the rest of
the pool, which is how you write a fixed result - see "The Founders' Rite" in the
base set.

## Layout

```
src/game/       engine - no React, fully testable
  types.ts        content pack + save shapes
  taxonomy.ts     arbitrary-depth tree
  breeding.ts     the weighted pool
  economy.ts      production, xp, merging, bakeries
  engine.ts       every player action
  storage.ts      local save/load, import/export, validation
  cloud.ts        accounts and cloud saves
  content.ts      the base set
supabase/       database schema to paste into Supabase
src/components/ one file per tab
scripts/        self-tests
```

Every dragon carries per-individual fields - traits, parents, generation, notes,
and an open `custom` bag - so new systems can hang off an existing save without a
migration.

## Individual value

Each dragon rolls **one number, 0-31**, when it hatches - the same range Pokemon
uses. It is fixed for life and never inherited: two flawless parents have the
same odds of a 0 as anyone else.

What that number does is configured in **Admin -> Individual value**, so it can
be respecified without touching a single existing dragon:

| Setting | Default | Meaning |
|---|---|---|
| Name | Individual Value | What players see it called |
| Coins bonus at 31 | 0.25 | A perfect dragon earns 25% more than a 0 |
| XP bonus at 31 | 0 | Off by default |

A magnitude of 0 switches that effect off while the number keeps rolling and
recording, so you can attach it to whatever you specify later.

## Incubation

Every dragon sets its own `incubationSeconds`, edited per dragon in Admin. The
timer is decided by whatever is inside the egg, not by the parents - so a long
wait quietly tells the player something rare is coming. Dragons that set no time
fall back to `defaultIncubationSeconds`.

The placeholders run from one minute for the commons to an hour for the
legendary.

## Accounts

Three ways in, all in the **Account** tab:

- **Guest** - one tap, no details. Progress saves to the cloud immediately.
- **Email and password**
- **Google**

A guest is a real account identified by a signed token in their browser, not by
their IP. Converting a guest to email or Google keeps the same user id, so every
dragon, coin and codex entry carries over with nothing to migrate.

IP is recorded once, next to the save, when a guest account is created. It is
there for rate-limiting and abuse review only. It is deliberately not used to
identify anyone: carrier-grade NAT puts thousands of unrelated people behind one
address, so IP-keyed accounts would hand strangers each other's progress and
would lose a player's dragons the moment their address changed.

### Setting it up

1. Create a project at supabase.com. It is free at this scale.
2. Open the SQL editor and run `supabase/schema.sql` from this repo. That makes
   the `saves` table and locks each row to its owner.
3. In **Authentication -> Providers**, enable Email, Google, and Anonymous
   sign-ins.
4. Copy `.env.example` to `.env.local` and fill in the two values from
   **Project settings -> API**.
5. In Vercel, add those same two variables under **Settings -> Environment
   Variables**, then redeploy.

Saves are one JSON blob per player, written a few seconds after any change, with
row-level security so nobody can read another player's row. Because coins bank
against a timestamp, offline earnings work as soon as saves live on the server.

Everything storage-related lives in `src/game/storage.ts` (local) and
`src/game/cloud.ts` (server). No game logic knows where a save lives.
