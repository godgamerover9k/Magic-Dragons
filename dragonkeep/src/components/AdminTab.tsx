"use client";

import { useMemo, useState, type ReactNode } from "react";
import { defaultContentPack } from "@/game/content";
import { grantDragon } from "@/game/engine";
import { flattenTree, validateReparent } from "@/game/taxonomy";
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
  Rarity,
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
        <Field label="Pack name">
          <input
            value={pack.name}
            onChange={(e) => edit((p) => ({ ...p, name: e.target.value }))}
          />
        </Field>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            variant="solid"
            onClick={() => downloadJson(`${slug(pack.name)}-pack.json`, pack)}
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

      <Section title={`Breeding rules · ${pack.breedingRules.length}`}>
        <RulesEditor pack={pack} edit={edit} />
      </Section>

      <Section title="Individual value">
        <IvEditor pack={pack} edit={edit} />
      </Section>

      <Section title={`Rarities · ${Object.keys(pack.rarities).length}`}>
        <RarityEditor pack={pack} edit={edit} />
      </Section>

      <Section title="Balance">
        <BalanceEditor pack={pack} edit={edit} />
      </Section>

      <Section title="Testing shortcuts">
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => setSave({ ...save, coins: save.coins + 50000 })}>
            +50,000 coins
          </Button>
          <Button onClick={() => setSave({ ...save, food: save.food + 5000 })}>
            +5,000 food
          </Button>
          <Button onClick={() => setSave({ ...save, roostCapacity: save.roostCapacity + 5 })}>
            +5 perches
          </Button>
          <Button
            onClick={() =>
              setSave({ ...save, discovered: Object.keys(pack.species) })
            }
          >
            Reveal codex
          </Button>
        </div>
        <div className="mt-3">
          <Field label="Grant a dragon">
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                act((s) => grantDragon(pack, s, e.target.value, Date.now()));
              }}
            >
              <option value="">Choose a species…</option>
              {Object.values(pack.species).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Section>
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

  const remove = () => {
    if (!node) return;
    const used = Object.values(pack.species).filter((s) => s.taxonId === node.id);
    const kids = Object.values(pack.taxa).filter((t) => t.parentId === node.id);
    if (used.length || kids.length) {
      notify(
        `“${node.name}” still holds ${used.length} dragons and ${kids.length} sub-branches. Move them first.`,
        false,
      );
      return;
    }
    edit((p) => {
      const taxa = { ...p.taxa };
      delete taxa[node.id];
      return { ...p, taxa };
    });
    setSelected(null);
  };

  return (
    <div className="space-y-3">
      <div className="max-h-72 overflow-y-auto rounded border border-line">
        {rows.map(({ taxon, depth }) => (
          <button
            key={taxon.id}
            type="button"
            onClick={() => setSelected(taxon.id)}
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
          <Field label="Rank label" hint="Free text — Order, Clade, Bloodline, anything.">
            <input value={node.rank ?? ""} onChange={(e) => update({ rank: e.target.value })} />
          </Field>
          <Field label="Description">
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
          <Button variant="danger" onClick={remove}>
            Delete branch
          </Button>
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
    const firstRarity = Object.values(pack.rarities).sort((a, b) => a.order - b.order)[0];
    const draft: Species = {
      id,
      name: "New Dragon",
      taxonId: firstTaxon,
      rarityId: firstRarity?.id ?? "common",
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
            <Field label="Rarity">
              <select
                value={species.rarityId}
                onChange={(e) => update({ rarityId: e.target.value })}
              >
                {Object.values(pack.rarities)
                  .sort((a, b) => a.order - b.order)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
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
      exclusive: false,
      priority: 0,
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
            {r.exclusive && <span className="eyebrow ml-auto shrink-0">guaranteed</span>}
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
              checked={rule.exclusive}
              onChange={(e) => update({ exclusive: e.target.checked })}
            />
            Guaranteed — this rule replaces the whole pool
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

function RarityEditor({
  pack,
  edit,
}: {
  pack: ContentPack;
  edit: (fn: (p: ContentPack) => ContentPack) => void;
}) {
  const update = (id: string, patch: Partial<Rarity>) =>
    edit((p) => ({
      ...p,
      rarities: { ...p.rarities, [id]: { ...p.rarities[id], ...patch } },
    }));

  return (
    <div className="space-y-3">
      {Object.values(pack.rarities)
        .sort((a, b) => a.order - b.order)
        .map((r) => (
          <div key={r.id} className="rounded border border-line p-2.5">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ background: r.color }}
              />
              <input
                value={r.name}
                onChange={(e) => update(r.id, { name: e.target.value })}
              />
              <input
                type="color"
                className="h-8 w-12 shrink-0 p-0.5"
                value={r.color}
                onChange={(e) => update(r.id, { color: e.target.value })}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Coin multiplier">
                <input
                  type="number"
                  step="0.05"
                  value={r.productionMultiplier}
                  onChange={(e) =>
                    update(r.id, { productionMultiplier: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="XP multiplier">
                <input
                  type="number"
                  step="0.05"
                  value={r.xpMultiplier}
                  onChange={(e) => update(r.id, { xpMultiplier: Number(e.target.value) })}
                />
              </Field>
              <Field label="Max tier">
                <input
                  type="number"
                  value={r.maxTier}
                  onChange={(e) => update(r.id, { maxTier: Number(e.target.value) })}
                />
              </Field>
              <Field
                label="Merge costs"
                hint="Duplicates per tier step, comma separated."
              >
                <input
                  value={r.mergeCosts.join(", ")}
                  onChange={(e) =>
                    update(r.id, {
                      mergeCosts: e.target.value
                        .split(",")
                        .map((n) => Number(n.trim()))
                        .filter((n) => Number.isFinite(n) && n > 0),
                    })
                  }
                />
              </Field>
            </div>
          </div>
        ))}
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
      {num("Perch cost", b.roostSlotCost, (n) => set({ roostSlotCost: n }))}
      {num("Perch cost growth", b.roostSlotCostGrowth, (n) => set({ roostSlotCostGrowth: n }), undefined, "0.05")}
      {num("Coin storage hours", b.coinStorageHours, (n) => set({ coinStorageHours: n }))}
      {num("Level coefficient", b.production.levelCoefficient, (n) => set({ production: { ...b.production, levelCoefficient: n } }), "Each level adds this share of base output.", "0.01")}
      {num("Level exponent", b.production.levelExponent, (n) => set({ production: { ...b.production, levelExponent: n } }), "Above 1 makes late levels worth more.", "0.05")}
      {num("Tier multiplier", b.production.tierMultiplier, (n) => set({ production: { ...b.production, tierMultiplier: n } }), "Output per tier step.", "0.05")}
      {num("Max level", b.maxLevel, (n) => set({ maxLevel: n }))}
      {num("XP base", b.levelXpBase, (n) => set({ levelXpBase: n }))}
      {num("XP exponent", b.levelXpExponent, (n) => set({ levelXpExponent: n }), "How fast levels get expensive.", "0.05")}
      {num("Max bakeries", b.maxBakeries, (n) => set({ maxBakeries: n }))}
    </div>
  );
}
