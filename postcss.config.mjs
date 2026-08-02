# Dragonkeep

**The content is deliberately minimal.** Five placeholder dragons on a
Dragon -> Elemental -> Fire/Earth/Water/Air tree, and one breeding rule of each
kind. They exist so every system has something to stand on and so the shape of
each rule is visible. Replace all of it in Admin.

| Dragon | Element | Price | Base coins/hr |
|---|---|---|---|
| Fire Dragon | Fire | 250 | 20 |
| Earth Dragon | Earth | 500 | 24 |
| Water Dragon | Water | 900 | 28 |
| Air Dragon | Air | bred only | 48 |
| Elder Dragon | Elemental | bred only | 400 |

A text-based dragon collecting game. Next.js App Router, deployable to Vercel as-is.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run check    # engine self-tests (72 checks)
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
| Coins bonus at 31 | 0.6 | A perfect dragon earns 60% more than a 0 |
| XP bonus at 31 | 0 | Off by default |
| Curve exponent | 3 | Bends the payout toward the top of the range |
| Disadvantage | on | Roll twice, keep the worse |

Because the payout is cubed, the bottom of the range is nearly worthless - a 4
is worth about 0.2% while a 31 is worth the full 60% - so the last few points
carry most of the value. Disadvantage rolls two values and keeps the lower one,
which drops the average roll from about 15.5 to about 10 and makes a 31 roughly
thirty times rarer than a flat roll would.

A magnitude of 0 switches that effect off while the number keeps rolling and
recording, so you can attach it to whatever you specify later.

## Incubation

Every dragon sets its own `incubationSeconds`, edited per dragon in Admin. The
timer is decided by whatever is inside the egg, not by the parents - so a long
wait quietly tells the player something rare is coming. Dragons that set no time
fall back to `defaultIncubationSeconds`.

The placeholders run from one minute for the commons to an hour for the
legendary.

## Admin mode

Admin tab, top section. While it is on, coins and food are unlimited and never
deducted, the roost never fills, egg and oven timers can be skipped, and the
breeding screen shows the full weighted pool with odds. With it off, a player is
told nothing about what a pairing might produce.

Turning it off does not grant a balance - you keep whatever you actually had.

## Bakeries

Ovens do nothing on their own. You give one an order, pay for it, and it bakes
for a set time. Orders are content, in Balance:

| Order | Cost | Time | Food |
|---|---|---|---|
| Scraps | free | 2m | 12 |
| Small Order | 150 | 10m | 80 |
| Standing Order | 900 | 1h | 600 |
| Banquet | 5,000 | 6h | 4,500 |

The cheapest is deliberately free, so a player with no coins can always make
food. Each step up costs more, takes longer, and pays better per minute. More
ovens bake in parallel.

## Two cost curves

They are deliberately different shapes.

**Perches are polynomial.** The nth extra perch costs `roostSlotCost × n ^ 2` —
800, 3,200, 7,200, 12,800, 20,000. Each costs more than the last, but the
multiple between them keeps shrinking, so a large roost stays reachable.

**Ovens are exponential.** Each costs `bakeryCostGrowth` times the one before —
350, 1,050, 3,150, 9,450. A fourth oven is a real commitment.

The result is that space for dragons is something a player can keep buying,
while parallel food production is not.

## Coin storage

A dragon banks coins until it hits its limit, then stops earning until you
collect. Each dragon can set its own limit two ways, in Admin:

- **Storage hours** - the base, measured in hours of output at level 1 tier 1.
  Falls back to `coinStorageHours` in Balance.
- **Flat coin cap** - a hard ceiling in coins. Overrides the hours and does not
  scale, so a high-level dragon fills it faster and faster. Leave at 0 for none.

Capacity has its own growth curve in Balance, deliberately steeper than
production. Raising a dragon increases what it earns per hour, but increases what
it can hold by more, so the gap between collections gets longer rather than
shorter. Tuned with `capacity.levelCoefficient`, `capacity.levelExponent` and
`capacity.tierMultiplier`.

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
