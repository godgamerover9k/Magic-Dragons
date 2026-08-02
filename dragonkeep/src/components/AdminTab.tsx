"use client";

import { useMemo, useState, type ReactNode } from "react";
import { defaultContentPack } from "@/game/content";
import {
  buildPool,
  conditionsMet,
  probeDragon,
  ruleMatchesPair,
} from "@/game/breeding";
import { colorOf } from "@/game/economy";
import { grantDragon, setAdminMode, skipIncubation } from "@/game/engine";
import {
  flattenTree,
  removalImpact,
  removeTaxon,
  validateReparent,
} from "@/game/taxonomy";
import {
  downloadJson,
  readJsonFile,
  validatePack,
  type Issue,
} from "@/game/storage";
import { IV_MAX } from "@/game/types";
import type {
  BreedingRule,
  ContentPack,
  Matcher,
  SaveGame,
  Species,
  Taxon,
} from "@/game/types";
import type { Game } from "@/game/useGame";
import { Button, Field, Panel } from "./ui";

const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `id-${Math.random().toString(36).slice(2, 7)}`;

function uniqueId(base: string, taken: Record<string, unknown>) {
  let id = slug(base);
  let n = 2;
  while (id in taken) id = `${slug(base)}-${n++}`;
  return id;
}

export function AdminTab({ game }: { game: Game }) {
  const { pack, setPack, save, setSave, act, notify, resetEverything } = game;
  const issues = useMemo(() => validatePack(pack), [pack]);
  if (!save) return null;

  const edit = (fn: (draft: ContentPack) => ContentPack) => setPack(fn(pack));

  return (
    <div className="space-y-3">
      <p className="rounded border border-line bg-raised px-3 py-2 text-[11px] leading-snug text-muted">
        Everything here edits the content pack — the design of the game, separate from
        your progress. Changes apply instantly. Download the pack before you close the
        tab; browser storage is not a backup.
      </p>

      <IssueList issues={issues} />

      <Section title="Files" defaultOpen>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Pack name">
            <input
              value={pack.name}
              onChange={(e) => edit((p) => ({ ...p, name: e.target.value }))}
            />
          </Field>
          <Field
            label="Version"
            hint="Raise this before shipping, or players keep the pack they already have."
          >
            <input
              type="number"
              value={pack.version ?? 1}
              onChange={(e) =>
                edit((p) => ({ ...p, version: Math.max(1, Number(e.target.value) || 1) }))
              }
            />
          </Field>
        </div>

        <div className="mt-3 rounded border border-line bg-raised p-2.5 text-[11px] leading-snug text-muted">
          <p className="text-bone">To ship your changes to everyone</p>
          <p className="mt-1">
            1. Raise the version above. 2. Download the pack — it saves as{" "}
            <span className="num">pack.json</span>. 3. On GitHub, replace{" "}
            <span className="num">src/game/pack.json</span> with it and commit. Vercel
            rebuilds on its own, and anyone on an older version is moved across on their
            next visit.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            variant="solid"
            onClick={() => downloadJson("pack.json", pack)}
          >
            Download content pack
          </Button>
          <UploadButton
            label="Load content pack"
            onFile={async (file) => {
              try {
                const loaded = await readJsonFile<ContentPack>(file);
                if (!loaded.species || !loaded.taxa)
                  throw new Error("That file is not a content pack.");
                setPack(loaded);
                notify("Content pack loaded.");
              } catch (err) {
                notify((err as Error).message, false);
              }
            }}
          />
          <Button onClick={() => downloadJson("dragonkeep-save.json", save)}>
            Download save
          </Button>
          <UploadButton
            label="Load save"
            onFile={async (file) => {
              try {
                const loaded = await readJsonFile<SaveGame>(file);
                if (!loaded.dragons) throw new Error("That file is not a save.");
                setSave(loaded);
                notify("Save loaded.");
              } catch (err) {
                notify((err as Error).message, false);
              }
            }}
          />
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Replace the current pack with the base set? Your progress is kept."))
                setPack(defaultContentPack());
            }}
          >
            Restore base set
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Wipe progress AND content? This cannot be undone.")) resetEverything();
            }}
          >
            Reset everything
          </Button>
        </div>
      </Section>

      <Section title={`Taxonomy · ${Object.keys(pack.taxa).length} nodes`}>
        <TaxonomyEditor pack={pack} edit={edit} notify={notify} />
      </Section>

      <Section title={`Dragons · ${Object.keys(pack.species).length}`}>
        <SpeciesEditor pack={pack} edit={edit} />
      </Section>

      <Section title="Odds calculator">
        <OddsCalculator pack={pack} />
      </Section>

      <Section title={`Breeding rules · ${pack.breedingRules.length}`}>
        <RulesEditor pack={pack} edit={edit} />
      </Section>

      <Section title="Individual value">
        <IvEditor pack={pack} edit={edit} />
      </Section>

      <Section title="Balance">
        <BalanceEditor pack={pack} edit={edit} />
      </Section>

      <Section title="Testing shortcuts" defaultOpen>
        <div className="rounded border border-line p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-sm">Admin mode</p>
              <p className="mt-1 text-[11px] leading-snug text-muted">
                Coins and food become unlimited, the roost never fills, timers can be
                skipped, and breeding odds are shown before you commit. Nothing is spent
                while this is on.
              </p>
            </div>
            <Button
              variant={save.adminMode ? "solid" : "outline"}
              size="md"
              onClick={() => act((s) => setAdminMode(s, !s.adminMode))}
            >
              {save.adminMode ? "On" : "Off"}
            </Button>
          </div>
        </div>

        {save.adminMode && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button
              onClick={() => setSave({ ...save, roostCapacity: save.roostCapacity + 10 })}
            >
              +10 perches
            </Button>
            <Button onClick={() => setSave({ ...save, discovered: Object.keys(pack.species) })}>
              Reveal codex
            </Button>
            <Button
              disabled={!save.breeding}
              onClick={() => act((s) => skipIncubation(s, Date.now()))}
            >
              Hatch egg now
            </Button>
          </div>
        )}

        <div className="mt-3">
          <Field label="Grant a dragon">
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                act((s) => grantDragon(pack, s, e.target.value, Date.now()));
              }}
            >
              <option value="">Choose a dragon…</option>
              {Object.values(pack.species).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="mt-3 text-[11px] text-muted">
          Turning admin mode off leaves whatever coins and food you actually had. It does
          not hand you a balance.
        </p>
      </Section>
    </div>
  );
}

// --- Odds calculator -------------------------------------------------------

function OddsCalculator({ pack }: { pack: ContentPack }) {
  const ids = Object.keys(pack.species);
  const [a, setA] = useState(ids[0] ?? "");
  const [b, setB] = useState(ids[1] ?? ids[0] ?? "");
  const [tier, setTier] = useState(1);
  const [level, setLevel] = useState(1);
  const [ivA, setIvA] = useState(0);
  const [ivB, setIvB] = useState(0);

  const parentA = probeDragon(a, { tier, level, iv: ivA });
  const parentB = probeDragon(b, { tier, level, iv: ivB });

  const pool =
    pack.species[a] && pack.species[b]
      ? buildPool(pack, parentA, parentB)
      : null;

  // Rules that fit the pair but were turned away, and the reason why. This is
  // usually what you actually want to know when a combo is not appearing.
  const blocked = pack.breedingRules
    .filter((rule) => rule.enabled)
    .filter((rule) => ruleMatchesPair(pack, rule, parentA, parentB))
    .filter((rule) => !conditionsMet(pack, rule, parentA, parentB))
    .map((rule) => {
      const c = rule.conditions ?? {};
      const reasons: string[] = [];
      if (c.minTier !== undefined && tier < c.minTier)
        reasons.push(`needs tier ${c.minTier}`);
      if (c.minLevel !== undefined && level < c.minLevel)
        reasons.push(`needs level ${c.minLevel}`);
      if (c.minIv !== undefined && (ivA < c.minIv || ivB < c.minIv))
        reasons.push(`needs IV ${c.minIv}+`);
      if (c.maxIv !== undefined && (ivA > c.maxIv || ivB > c.maxIv))
        reasons.push(`needs IV ${c.maxIv} or under`);
      if (c.differentSpecies && a === b) reasons.push("parents must differ");
      if (c.differentBranchUnder !== undefined) {
        const branch = pack.taxa[c.differentBranchUnder]?.name ?? c.differentBranchUnder;
        reasons.push(`parents must be in different parts of ${branch}`);
      }
      if (c.minIvEither !== undefined && Math.max(ivA, ivB) < c.minIvEither)
        reasons.push(`needs one parent at IV ${c.minIvEither}+`);
      if (c.maxIvEither !== undefined && Math.min(ivA, ivB) > c.maxIvEither)
        reasons.push(`needs one parent at IV ${c.maxIvEither} or under`);
      return { rule, reasons };
    });

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-muted">
        Works on hypothetical parents — you do not need to own either. Shows the pool
        exactly as a real breed would build it.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="First parent">
          <select value={a} onChange={(e) => setA(e.target.value)}>
            {Object.values(pack.species).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Second parent">
          <select value={b} onChange={(e) => setB(e.target.value)}>
            {Object.values(pack.species).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Tier (both)">
          <input
            type="number"
            min={1}
            value={tier}
            onChange={(e) => setTier(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
        <Field label="Level (both)">
          <input
            type="number"
            min={1}
            value={level}
            onChange={(e) => setLevel(Math.max(1, Number(e.target.value) || 1))}
          />
        </Field>
        <Field label={`IV, first (0-${IV_MAX})`}>
          <input
            type="number"
            min={0}
            max={IV_MAX}
            value={ivA}
            onChange={(e) => setIvA(Number(e.target.value) || 0)}
          />
        </Field>
        <Field label={`IV, second (0-${IV_MAX})`}>
          <input
            type="number"
            min={0}
            max={IV_MAX}
            value={ivB}
            onChange={(e) => setIvB(Number(e.target.value) || 0)}
          />
        </Field>
      </div>


      {pool && (
        <div className="rounded border border-line p-2.5">
          <p className="eyebrow mb-2">Total weight {pool.totalWeight}</p>
          <table className="w-full text-xs">
            <tbody>
              {pool.entries.map((entry) => {
                const pct = (entry.weight / pool.totalWeight) * 100;
                return (
                  <tr key={entry.speciesId} className="border-b border-line/60">
                    <td className="py-1 pr-2">
                      <span
                        className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle"
                        style={{ background: colorOf(pack, entry.speciesId) }}
                      />
                      {pack.species[entry.speciesId]?.name}
                    </td>
                    <td className="py-1 pr-2 text-[10px] text-muted">
                      {entry.sources.join(", ")}
                    </td>
                    <td className="num py-1 text-right">{entry.weight}</td>
                    <td className="num py-1 pl-2 text-right">
                      {pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {blocked.length > 0 && (
        <div className="rounded border border-line p-2.5">
          <p className="eyebrow mb-1.5">Rules that fit but did not fire</p>
          <ul className="space-y-1 text-[11px]">
            {blocked.map(({ rule, reasons }) => (
              <li key={rule.id} className="flex justify-between gap-2">
                <span>{rule.label}</span>
                <span className="shrink-0 text-warn">
                  {reasons.join(", ") || "a condition was not met"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Shell bits ------------------------------------------------------------

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-3 text-left"
        aria-expanded={open}
      >
        <span className="font-display text-sm">{title}</span>
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="border-t border-line p-3">{children}</div>}
    </Panel>
  );
}

function UploadButton({
  label,
  onFile,
}: {
  label: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center rounded border border-line px-2.5 py-1.5 text-xs hover:border-verdigris hover:text-verdigris">
      {label}
      <input
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0)
    return (
      <p className="rounded border border-verdigris/40 bg-verdigris/10 px-3 py-2 text-xs text-verdigris">
        Content checks out — every dragon is reachable and every rule points somewhere real.
      </p>
    );
  return (
    <Panel className="divide-y divide-line">
      {issues.map((issue, i) => (
        <div key={i} className="p-2.5 text-xs">
          <span className={issue.level === "error" ? "text-warn" : "text-muted"}>
            {issue.level === "error" ? "Broken" : "Check"} · {issue.where}
          </span>
          <p className="mt-0.5">{issue.message}</p>
        </div>
      ))}
    </Panel>
  );
}

// --- Taxonomy --------------------------------------------------------------

function TaxonomyEditor({
  pack,
  edit,
  notify,
}: {
  pack: ContentPack;
  edit: (fn: (p: ContentPack) => ContentPack) => void;
  notify: (text: string, ok?: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string>("");
  const rows = flattenTree(pack);
  const node = selected ? pack.taxa[selected] : null;

  const addChild = (parentId: string | null) => {
    const id = uniqueId("new-taxon", pack.taxa);
    const taxon: Taxon = {
      id,
      name: "New taxon",
      parentId,
      rank: "",
      description: "",
      custom: {},
    };
    edit((p) => ({ ...p, taxa: { ...p.taxa, [id]: taxon } }));
    setSelected(id);
  };

  const update = (patch: Partial<Taxon>) => {
    if (!node) return;
    edit((p) => ({ ...p, taxa: { ...p.taxa, [node.id]: { ...node, ...patch } } }));
  };

  const impact = node ? removalImpact(pack, node.id) : null;
  const holdsSomething =
    impact !== null && (impact.children.length > 0 || impact.species.length > 0);

  const remove = () => {
    if (!node) return;
    const destination = destinationId === "" ? null : destinationId;

    if (holdsSomething) {
      const parts: string[] = [];
      if (impact!.species.length)
        parts.push(
          `${impact!.species.length} dragon${impact!.species.length === 1 ? "" : "s"}`,
        );
      if (impact!.children.length)
        parts.push(
          `${impact!.children.length} sub-branch${impact!.children.length === 1 ? "" : "es"}`,
        );
      const where = destination ? pack.taxa[destination]?.name : "the top level";
      if (!confirm(`Delete “${node.name}” and move ${parts.join(" and ")} to ${where}?`))
        return;
    }

    const result = removeTaxon(pack, node.id, destination);
    if (result.error) return notify(result.error, false);
    edit(() => result.pack);
    setSelected(null);
    setDestinationId("");
    notify(`Deleted “${node.name}”.`);
  };

  return (
    <div className="space-y-3">
      <div className="max-h-72 overflow-y-auto rounded border border-line">
        {rows.map(({ taxon, depth }) => (
          <button
            key={taxon.id}
            type="button"
            onClick={() => {
              setSelected(taxon.id);
              setDestinationId(taxon.parentId ?? "");
            }}
            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${
              selected === taxon.id ? "bg-verdigris/15 text-verdigris" : ""
            }`}
            style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
          >
            <span className="truncate">{taxon.name}</span>
            {taxon.rank && <span className="eyebrow shrink-0">{taxon.rank}</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button onClick={() => addChild(null)}>Add root branch</Button>
        <Button onClick={() => addChild(selected)} disabled={!node}>
          Add branch under {node ? node.name : "…"}
        </Button>
      </div>

      {node && (
        <div className="space-y-2 rounded border border-line p-3">
          <Field label="Name">
            <input value={node.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field label="Rank label" hint="Your own note. Not shown to players.">
            <input value={node.rank ?? ""} onChange={(e) => update({ rank: e.target.value })} />
          </Field>
          <Field label="Description" hint="Your own note. Not shown to players.">
            <textarea
              rows={2}
              value={node.description ?? ""}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
          <Field label="Sits under">
            <select
              value={node.parentId ?? ""}
              onChange={(e) => {
                const newParent = e.target.value || null;
                const problem = validateReparent(pack, node.id, newParent);
                if (problem) return notify(problem, false);
                update({ parentId: newParent });
              }}
            >
              <option value="">(top level)</option>
              {Object.values(pack.taxa)
                .filter((t) => t.id !== node.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="border-t border-line pt-2">
            {holdsSomething ? (
              <>
                <p className="mb-1.5 text-[11px] leading-snug text-muted">
                  This branch holds{" "}
                  {impact!.species.length > 0 &&
                    `${impact!.species.length} dragon${impact!.species.length === 1 ? "" : "s"}`}
                  {impact!.species.length > 0 && impact!.children.length > 0 && " and "}
                  {impact!.children.length > 0 &&
                    `${impact!.children.length} sub-branch${impact!.children.length === 1 ? "" : "es"}`}
                  . Deleting it moves them somewhere else rather than destroying them.
                </p>
                <Field label="Move its contents to">
                  <select
                    value={destinationId}
                    onChange={(e) => setDestinationId(e.target.value)}
                  >
                    <option value="">(top level)</option>
                    {flattenTree(pack)
                      .filter(({ taxon }) => taxon.id !== node.id)
                      .map(({ taxon, depth }) => (
                        <option key={taxon.id} value={taxon.id}>
                          {"\u00A0".repeat(depth * 2)}
                          {taxon.name}
                        </option>
                      ))}
                  </select>
                </Field>
                {impact!.species.length > 0 && destinationId === "" && (
                  <p className="mt-1 text-[11px] text-warn">
                    Dragons need a real branch, so pick one before deleting.
                  </p>
                )}
              </>
            ) : (
              <p className="mb-1.5 text-[11px] text-muted">
                Nothing sits in this branch, so deleting it is safe.
              </p>
            )}
            <div className="mt-2">
              <Button
                variant="danger"
                onClick={remove}
                disabled={impact !== null && impact.species.length > 0 && destinationId === ""}
              >
                Delete branch
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Species ---------------------------------------------------------------

function SpeciesEditor({
  pack,
  edit,
}: {
  pack: ContentPack;
  edit: (fn: (p: ContentPack) => ContentPack) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const species = selected ? pack.species[selected] : null;

  const create = () => {
    const id = uniqueId("new-dragon", pack.species);
    const firstTaxon = Object.keys(pack.taxa)[0];
    const draft: Species = {
      id,
      name: "New Dragon",
      taxonId: firstTaxon,
      color: "#8A93A6",
      tags: [],
      baseProduction: 25,
      description: "",
      obtainable: true,
      custom: {},
    };
    edit((p) => ({ ...p, species: { ...p.species, [id]: draft } }));
    setSelected(id);
  };

  const update = (patch: Partial<Species>) => {
    if (!species) return;
    edit((p) => ({
      ...p,
      species: { ...p.species, [species.id]: { ...species, ...patch } },
    }));
  };

  const remove = () => {
    if (!species) return;
    edit((p) => {
      const next = { ...p.species };
      delete next[species.id];
      return {
        ...p,
        species: next,
        breedingRules: p.breedingRules.map((r) => ({
          ...r,
          outcomes: r.outcomes.filter((o) => o.speciesId !== species.id),
        })),
      };
    });
    setSelected(null);
  };

  return (
    <div className="space-y-3">
      <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)}>
        <option value="">Choose a dragon to edit…</option>
        {Object.values(pack.species)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
      </select>

      <Button variant="solid" onClick={create}>
        Add a new dragon
      </Button>

      {species && (
        <div className="space-y-2 rounded border border-line p-3">
          <Field label="Name">
            <input value={species.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Branch">
              <select
                value={species.taxonId}
                onChange={(e) => update({ taxonId: e.target.value })}
              >
                {flattenTree(pack).map(({ taxon, depth }) => (
                  <option key={taxon.id} value={taxon.id}>
                    {"\u00A0".repeat(depth * 2)}
                    {taxon.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Accent colour">
              <input
                type="color"
                className="h-9 p-0.5"
                value={species.color ?? "#8A93A6"}
                onChange={(e) => update({ color: e.target.value })}
              />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Base coins per hour" hint="Before rarity, level and tier.">
              <input
                type="number"
                value={species.baseProduction}
                onChange={(e) => update({ baseProduction: Number(e.target.value) })}
              />
            </Field>
            <Field label="Market price" hint="Leave 0 to keep it out of the market.">
              <input
                type="number"
                value={species.marketPrice ?? 0}
                onChange={(e) => update({ marketPrice: Number(e.target.value) || undefined })}
              />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field
              label="Storage hours"
              hint={`Hours of its own output it can bank. Leave 0 to use the default of ${pack.balance.coinStorageHours}.`}
            >
              <input
                type="number"
                value={species.coinStorageHours ?? 0}
                onChange={(e) =>
                  update({ coinStorageHours: Number(e.target.value) || undefined })
                }
              />
            </Field>
            <Field
              label="Flat coin cap"
              hint="A hard ceiling in coins. Overrides the hours and does not grow with the dragon. Leave 0 for none."
            >
              <input
                type="number"
                value={species.coinCapacity ?? 0}
                onChange={(e) =>
                  update({ coinCapacity: Number(e.target.value) || undefined })
                }
              />
            </Field>
          </div>
          <Field
            label="Incubation seconds"
            hint={`How long an egg of this dragon takes to hatch. Leave 0 to use the default of ${pack.balance.defaultIncubationSeconds}s.`}
          >
            <input
              type="number"
              value={species.incubationSeconds ?? 0}
              onChange={(e) =>
                update({ incubationSeconds: Number(e.target.value) || undefined })
              }
            />
          </Field>
          <Field label="Tags" hint="Comma separated. Breeding rules can match these.">
            <input
              value={species.tags.join(", ")}
              onChange={(e) =>
                update({
                  tags: e.target.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <Field label="Codex entry">
            <textarea
              rows={3}
              value={species.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="w-auto"
              checked={species.obtainable}
              onChange={(e) => update({ obtainable: e.target.checked })}
            />
            Can be obtained
          </label>
          <Button variant="danger" onClick={remove}>
            Delete dragon
          </Button>
        </div>
      )}
    </div>
  );
}

// --- Breeding rules --------------------------------------------------------

function RulesEditor({
  pack,
  edit,
}: {
  pack: ContentPack;
  edit: (fn: (p: ContentPack) => ContentPack) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const rule = pack.breedingRules.find((r) => r.id === selected) ?? null;

  const create = () => {
    const id = `rule-${Math.random().toString(36).slice(2, 8)}`;
    const draft: BreedingRule = {
      id,
      label: "New rule",
      a: { kind: "any" },
      b: { kind: "any" },
      outcomes: [],
      enabled: true,
    };
    edit((p) => ({ ...p, breedingRules: [...p.breedingRules, draft] }));
    setSelected(id);
  };

  const update = (patch: Partial<BreedingRule>) => {
    if (!rule) return;
    edit((p) => ({
      ...p,
      breedingRules: p.breedingRules.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)),
    }));
  };

  const remove = () => {
    if (!rule) return;
    edit((p) => ({
      ...p,
      breedingRules: p.breedingRules.filter((r) => r.id !== rule.id),
    }));
    setSelected(null);
  };

  return (
    <div className="space-y-3">
      <div className="max-h-56 overflow-y-auto rounded border border-line">
        {pack.breedingRules.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelected(r.id)}
            className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs ${
              selected === r.id ? "bg-verdigris/15 text-verdigris" : ""
            } ${r.enabled ? "" : "opacity-45"}`}
          >
            <span className="truncate">{r.label}</span>
          </button>
        ))}
      </div>

      <Button variant="solid" onClick={create}>
        Add a rule
      </Button>

      {rule && (
        <div className="space-y-2 rounded border border-line p-3">
          <Field label="Label" hint="Shown to the player next to the outcome.">
            <input value={rule.label} onChange={(e) => update({ label: e.target.value })} />
          </Field>

          <div className="grid gap-2 sm:grid-cols-2">
            <MatcherEditor
              label="First parent"
              pack={pack}
              matcher={rule.a}
              onChange={(a) => update({ a })}
            />
            <MatcherEditor
              label="Second parent"
              pack={pack}
              matcher={rule.b}
              onChange={(b) => update({ b })}
            />
          </div>
          <p className="text-[11px] text-muted">
            Order does not matter — the rule fires either way round.
          </p>

          <div>
            <p className="eyebrow mb-1.5">Outcomes and weights</p>
            <div className="space-y-1.5">
              {rule.outcomes.map((outcome, i) => (
                <div key={i} className="flex gap-1.5">
                  <select
                    value={outcome.speciesId}
                    onChange={(e) => {
                      const outcomes = [...rule.outcomes];
                      outcomes[i] = { ...outcome, speciesId: e.target.value };
                      update({ outcomes });
                    }}
                  >
                    {Object.values(pack.species).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="w-20 shrink-0"
                    value={outcome.weight}
                    onChange={(e) => {
                      const outcomes = [...rule.outcomes];
                      outcomes[i] = { ...outcome, weight: Number(e.target.value) };
                      update({ outcomes });
                    }}
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      update({ outcomes: rule.outcomes.filter((_, j) => j !== i) })
                    }
                  >
                    ✕
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-1.5">
              <Button
                onClick={() => {
                  const first = Object.keys(pack.species)[0];
                  update({ outcomes: [...rule.outcomes, { speciesId: first, weight: 10 }] });
                }}
              >
                Add outcome
              </Button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">
              Weights are relative. Against the parents&rsquo; {pack.balance.parentWeight}{" "}
              each, a weight of 10 is roughly a 1-in-11 chance.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Both parents at least tier">
              <input
                type="number"
                value={rule.conditions?.minTier ?? 0}
                onChange={(e) =>
                  update({
                    conditions: {
                      ...rule.conditions,
                      minTier: Number(e.target.value) || undefined,
                    },
                  })
                }
              />
            </Field>
            <Field label="Both parents at least IV">
              <input
                type="number"
                value={rule.conditions?.minIv ?? 0}
                onChange={(e) =>
                  update({
                    conditions: {
                      ...rule.conditions,
                      minIv: Number(e.target.value) || undefined,
                    },
                  })
                }
              />
            </Field>
            <Field label="Parents from different parts of">
              <select
                value={rule.conditions?.differentBranchUnder ?? ""}
                onChange={(e) =>
                  update({
                    conditions: {
                      ...rule.conditions,
                      differentBranchUnder: e.target.value || undefined,
                    },
                  })
                }
              >
                <option value="">(no requirement)</option>
                {flattenTree(pack).map(({ taxon, depth }) => (
                  <option key={taxon.id} value={taxon.id}>
                    {"\u00A0".repeat(depth * 2)}
                    {taxon.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="One parent at least IV">
              <input
                type="number"
                value={rule.conditions?.minIvEither ?? 0}
                onChange={(e) =>
                  update({
                    conditions: {
                      ...rule.conditions,
                      minIvEither: Number(e.target.value) || undefined,
                    },
                  })
                }
              />
            </Field>
            <Field label="One parent at most IV">
              <input
                type="number"
                value={rule.conditions?.maxIvEither ?? ""}
                placeholder="no limit"
                onChange={(e) =>
                  update({
                    conditions: {
                      ...rule.conditions,
                      maxIvEither:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label="Both parents at most IV">
              <input
                type="number"
                value={rule.conditions?.maxIv ?? ""}
                placeholder="no limit"
                onChange={(e) =>
                  update({
                    conditions: {
                      ...rule.conditions,
                      maxIv:
                        e.target.value === "" ? undefined : Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
            <Field label="Both parents at least level">
              <input
                type="number"
                value={rule.conditions?.minLevel ?? 0}
                onChange={(e) =>
                  update({
                    conditions: {
                      ...rule.conditions,
                      minLevel: Number(e.target.value) || undefined,
                    },
                  })
                }
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="w-auto"
              checked={rule.conditions?.differentSpecies ?? false}
              onChange={(e) =>
                update({
                  conditions: {
                    ...rule.conditions,
                    differentSpecies: e.target.checked || undefined,
                  },
                })
              }
            />
            Parents must be different dragons
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="w-auto"
              checked={rule.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            Active
          </label>

          <Field label="Designer notes">
            <textarea
              rows={2}
              value={rule.notes ?? ""}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </Field>

          <Button variant="danger" onClick={remove}>
            Delete rule
          </Button>
        </div>
      )}
    </div>
  );
}

function MatcherEditor({
  label,
  pack,
  matcher,
  onChange,
}: {
  label: string;
  pack: ContentPack;
  matcher: Matcher;
  onChange: (m: Matcher) => void;
}) {
  return (
    <div>
      <span className="eyebrow mb-1 block">{label}</span>
      <select
        value={matcher.kind}
        onChange={(e) => {
          const kind = e.target.value as Matcher["kind"];
          if (kind === "any") onChange({ kind: "any" });
          if (kind === "species")
            onChange({ kind: "species", speciesId: Object.keys(pack.species)[0] });
          if (kind === "taxon")
            onChange({
              kind: "taxon",
              taxonId: Object.keys(pack.taxa)[0],
              includeDescendants: true,
            });
          if (kind === "tag") onChange({ kind: "tag", tag: "" });
        }}
      >
        <option value="any">Any dragon</option>
        <option value="species">A specific dragon</option>
        <option value="taxon">Anything in a branch</option>
        <option value="tag">Anything with a tag</option>
      </select>

      {matcher.kind === "species" && (
        <select
          className="mt-1.5"
          value={matcher.speciesId}
          onChange={(e) => onChange({ kind: "species", speciesId: e.target.value })}
        >
          {Object.values(pack.species).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {matcher.kind === "taxon" && (
        <>
          <select
            className="mt-1.5"
            value={matcher.taxonId}
            onChange={(e) =>
              onChange({ ...matcher, kind: "taxon", taxonId: e.target.value })
            }
          >
            {flattenTree(pack).map(({ taxon, depth }) => (
              <option key={taxon.id} value={taxon.id}>
                {"\u00A0".repeat(depth * 2)}
                {taxon.name}
              </option>
            ))}
          </select>
          <label className="mt-1.5 flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              className="w-auto"
              checked={matcher.includeDescendants}
              onChange={(e) =>
                onChange({ ...matcher, kind: "taxon", includeDescendants: e.target.checked })
              }
            />
            Include sub-branches
          </label>
        </>
      )}

      {matcher.kind === "tag" && (
        <input
          className="mt-1.5"
          value={matcher.tag}
          placeholder="nocturnal"
          onChange={(e) => onChange({ kind: "tag", tag: e.target.value })}
        />
      )}
    </div>
  );
}

// --- Rarities and balance --------------------------------------------------

function IvEditor({
  pack,
  edit,
}: {
  pack: ContentPack;
  edit: (fn: (p: ContentPack) => ContentPack) => void;
}) {
  const iv = pack.iv;
  const set = (patch: Partial<typeof iv>) =>
    edit((p) => ({ ...p, iv: { ...p.iv, ...patch } }));

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-snug text-muted">
        Every dragon rolls one number from 0 to {IV_MAX} when it hatches, and it never
        changes. Magnitude is what a perfect {IV_MAX} is worth: 0.25 means a flawless
        dragon earns 25% more than one that rolled 0. Set a magnitude to 0 to switch that
        effect off.
      </p>

      <Field label="What players call it">
        <input value={iv.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Description">
        <input
          value={iv.description}
          onChange={(e) => set({ description: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Coins bonus at ${IV_MAX}`}>
          <input
            type="number"
            step="0.01"
            value={iv.productionMagnitude}
            onChange={(e) => set({ productionMagnitude: Number(e.target.value) })}
          />
        </Field>
        <Field label={`XP bonus at ${IV_MAX}`}>
          <input
            type="number"
            step="0.01"
            value={iv.growthMagnitude}
            onChange={(e) => set({ growthMagnitude: Number(e.target.value) })}
          />
        </Field>
      </div>
      <p className="text-[11px] text-muted">
        A dragon at {IV_MAX} currently earns{" "}
        {(iv.productionMagnitude * 100).toFixed(0)}% more coins and{" "}
        {(iv.growthMagnitude * 100).toFixed(0)}% more xp than one at 0.
      </p>
    </div>
  );
}

function BalanceEditor({
  pack,
  edit,
}: {
  pack: ContentPack;
  edit: (fn: (p: ContentPack) => ContentPack) => void;
}) {
  const b = pack.balance;
  const set = (patch: Partial<typeof b>) =>
    edit((p) => ({ ...p, balance: { ...p.balance, ...patch } }));

  const num = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    hint?: string,
    step = "1",
  ) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {num("Parent weight", b.parentWeight, (n) => set({ parentWeight: n }), "How strongly each parent sits in every breeding pool.")}
      {num("Default incubation seconds", b.defaultIncubationSeconds, (n) => set({ defaultIncubationSeconds: n }), "Used by dragons with no time of their own.")}
      {num("Starting coins", b.startingCoins, (n) => set({ startingCoins: n }))}
      {num("Starting food", b.startingFood, (n) => set({ startingFood: n }))}
      {num("Starting perches", b.roostCapacity, (n) => set({ roostCapacity: n }))}
      {num("Perch cost", b.roostSlotCost, (n) => set({ roostSlotCost: n }), "Cost of the first extra perch.")}
      {num("Perch cost exponent", b.roostSlotCostExponent, (n) => set({ roostSlotCostExponent: n }), "Polynomial. 2 makes the nth perch cost n² times the first.", "0.1")}
      {num("Bakery cost", b.bakeryCost, (n) => set({ bakeryCost: n }), "Cost of the first oven.")}
      {num("Bakery cost multiplier", b.bakeryCostGrowth, (n) => set({ bakeryCostGrowth: n }), "Exponential. Each oven costs this many times the last.", "0.1")}
      {num("Coin storage hours", b.coinStorageHours, (n) => set({ coinStorageHours: n }))}
      {num("Levels per tier step", b.power.tierWeight, (n) => set({ power: { tierWeight: n } }), "How much power one tier is worth. 12 means a tier beats twelve levels.", "1")}
      {num("Production exponent", b.production.exponent, (n) => set({ production: { exponent: n } }), "Below 1 gives diminishing returns, so levelling a weak dragon cannot catch a rare one.", "0.05")}
      {num("Capacity exponent", b.capacity.exponent, (n) => set({ capacity: { exponent: n } }), "Keep this above the production exponent or dragons will fill faster as they grow.", "0.05")}
      {num("Max level", b.maxLevel, (n) => set({ maxLevel: n }))}
      {num("XP base", b.levelXpBase, (n) => set({ levelXpBase: n }))}
      {num("XP exponent", b.levelXpExponent, (n) => set({ levelXpExponent: n }), "How fast levels get expensive.", "0.05")}
      {num("Max bakeries", b.maxBakeries, (n) => set({ maxBakeries: n }))}
    </div>
  );
}
