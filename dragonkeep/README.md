# Dragonkeep

**The content is deliberately minimal.** Five placeholder dragons on a
Dragon -> Elemental -> Fire/Earth/Water/Air tree, and one breeding rule of each
kind. They exist so every system has something to stand on and so the shape of
each rule is visible. Replace all of it in Admin.

| Dragon | Element | Price | Coins/min | Fills in |
|---|---|---|---|---|
| Fire Dragon | Fire | 2,250 | 3.0 | 20 min |
| Earth Dragon | Earth | 4,500 | 3.6 | 24 min |
| Water Dragon | Water | 8,100 | 4.2 | 30 min |
| Air Dragon | Air | bred only | 9.7 | 45 min |
| Elemental Dragon | Elemental | bred only | 15 | 45 min |

### Combos

| Parents | Result | Roughly |
|---|---|---|
| Fire + Water | Air | 23% |
| Earth + Water | Plant | 23% |
| Fire + Plant | Inferno | 17% |
| Plant + Plant | Life | 11% |
| Earth + Fire | Lava | 4% |
| Fire + Fire | Inferno | 1% |
| any two different Elementals | Elemental | 2-3% |
| Elemental + Earth | Metal | 20% |
| any two at IV 0 | Corruption | 17% |
| one parent at IV 0 | Corruption | 1.5% |
| any two at IV 31 | Perfection | 43% |
| one parent at IV 31 | Perfection | 1.5% |

Percentages assume both parents sit in the pool at the default weight of 50.

There are no rarity tiers. Every dragon states its own output outright, and can
optionally set its own accent colour, xp multiplier, merge costs, max tier,
storage and incubation. Anything left unset falls back to Balance.

Figures are at tier 1, level 1, IV 0. A fully raised Fire Dragon runs about
20 coins/min and holds about 3 hours of output.

A text-based dragon collecting game. Next.js App Router, deployable to Vercel as-is.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
npm run check    # engine self-tests (103 checks)
npm run build    # production build
```

## Deploying to Vercel

1. Push this folder to a GitHub repository.
2. At vercel.com, choose **Add New -> Project** and pick that repository.
3. Accept every default and press Deploy. There is nothing to configure.

Without Supabase keys the game plays fine and saves to the browser. Add the keys
and accounts switch on. See *Accounts* below.

## Shipping content changes

The shipped content lives in `src/game/pack.json`, not in any TypeScript file.
The loop is:

1. Design it in **Admin** on the live site. The validator flags broken
   references as you go.
2. Raise **Version** in Admin -> Files.
3. Press **Download content pack**. It saves as `pack.json`.
4. On GitHub, replace `src/game/pack.json` with that file and commit.

Vercel rebuilds on its own. Anyone still holding an older version is moved onto
the new pack the next time they open the game.

The version number is what makes that happen. A browser keeps whatever pack it
last saw - including a player's own Admin edits - unless the repo ships a higher
version, in which case the shipped one wins. Forget to raise it and returning
players will not see your changes.

`src/game/content.ts` now does nothing but read that JSON.

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

To ship your changes to everyone, see *Shipping content changes* above.

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

Conditions can require a minimum tier or level, an IV floor or ceiling on
**both** parents or on **either** parent, or that the two parents be different
dragons — which is what turns "anything in this branch" into "any two distinct
members of it".

Rules match in either order, and they only ever ADD weight. Nothing can remove
the parents from the pool, so no pairing is ever a certainty - every breed keeps
a real chance of returning a parent.

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

The base set runs from 5 minutes for a Fire Dragon to 24 hours for a Perfection
Dragon.

## Hatching

Hatching takes over the screen, because it is the only moment a player learns
what a pairing produced - the odds are hidden during play.

- **A dragon already in the codex** shows everything at once and gets out of the
  way.
- **A dragon new to the codex** is revealed in stages: the egg, then the name,
  then its figures. Confetti falls.
- **A flawless roll** (IV 31) puts a shine across the card and calls it out.

Both can happen together. The confetti scatter is derived from the dragon's id
rather than `Math.random`, so it is stable across re-renders, and every effect
is disabled under `prefers-reduced-motion`.

## Odds calculator

Admin -> Odds calculator. Pick any two dragons, set their tier, level and IVs,
and it shows the pool a real breed would build: every possible result, the
weight behind it, which rules contributed, and the resulting percentage.

You do not need to own either parent. It also lists rules that matched the pair
but were turned away, with the reason - usually the fastest way to find out why
a combo is not appearing.

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

## Food

Ovens produce food into one pool. There are no recipes and no food types — a
unit of food is a unit of food, worth `xpPerFood` experience, and the player
decides which dragon gets it.

Each order yields a different amount:

| Order | Cost | Time | Food |
|---|---|---|---|
| Scraps | free | 2m | 12 |
| Small Order | 1,350 | 10m | 80 |
| Standing Order | 8,100 | 1h | 600 |
| Banquet | 45,000 | 6h | 4,500 |

On a dragon card, **+1 / +10 / +100** feed fixed amounts and **To next level**
feeds exactly enough to level up. If there is not enough food for that, it feeds
everything available instead of refusing, and says how far short it fell.

A dragon's growth IV makes its food go further, so the amount needed is
per-dragon rather than a flat table.

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

## Who decides what happens

Signed in, the browser never writes progress. It sends an action - "feed dragon
X 50 food", "breed these two" - and the server loads the save it holds, decides
whether that action is legal against **that** state, rolls any randomness with
`crypto.getRandomValues`, stores the result and replies with the new save.

Every mutation is named in `src/game/actions.ts`, and the same dispatcher runs
in both places, so the rules cannot drift. Editing the page, overriding
`Math.random` or replaying a request gets a player nothing: the server recomputes
from its own copy.

The saves table has row-level security on and **no policies at all**, so the
anon key cannot read or write it. Only `/api/game`, using the service role key,
can touch it.

Designer actions - admin mode, granting dragons, skipping timers - are checked
against `ADMIN_EMAILS` on the server. Hiding the Admin tab is a convenience;
the refusal is what protects it.

Local play, with no Supabase keys set, runs the same dispatcher in the browser
against localStorage. Admin is open there because it is your own machine.

### What this does not cover

The content pack still ships to the browser, so a determined player can read
every dragon, rule and weight out of the JavaScript bundle. Hiding that needs
the pack kept server-side and only discovered species sent down - a separate
change.

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
4. Copy `.env.example` to `.env.local` and fill it in. Four variables now: the
   two public ones, plus `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAILS`, which
   must NOT be prefixed with NEXT_PUBLIC.
5. In Vercel, add all four under **Settings -> Environment Variables**, then
   redeploy.

Saves are one JSON blob per player, written a few seconds after any change, with
row-level security so nobody can read another player's row. Because coins bank
against a timestamp, offline earnings work as soon as saves live on the server.

Everything storage-related lives in `src/game/storage.ts` (local) and
`src/game/cloud.ts` (server). No game logic knows where a save lives.
