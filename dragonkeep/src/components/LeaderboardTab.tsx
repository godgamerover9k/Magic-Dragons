"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchLeaderboard, saveProfile, type BoardReply } from "@/game/remote";
import type { Game } from "@/game/useGame";
import { Button, Empty, Panel, SectionHeading } from "./ui";

const NAME_MAX = 24;

// The board ranks by how much of the codex a player has found. Nobody appears
// under a name they did not choose: everyone starts anonymous, and is asked once
// — only if they reach the top ten — whether they would rather be named.

export function LeaderboardTab({ game }: { game: Game }) {
  const { save, account, notify } = game;
  const [board, setBoard] = useState<BoardReply>({ entries: [], profile: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setBoard(await fetchLeaderboard());
    setLoading(false);
  }, []);

  // Reloading when the discovery count changes keeps a new find from sitting
  // behind a stale board. The fetch is queued rather than run in the effect body
  // so nothing sets state on the way through a render.
  const found = save?.discovered.length ?? 0;
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, found]);

  const profile = board.profile;

  return (
    <div className="space-y-3">
      {profile && profile.rank !== null && !profile.chosen && (
        <NamePrompt rank={profile.rank} onDone={setBoard} notify={notify} />
      )}

      <SectionHeading
        label="Most discovered"
        aside={
          <Button variant="ghost" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loading && board.entries.length === 0 ? (
        <p className="eyebrow px-1">Reading the register…</p>
      ) : board.entries.length === 0 ? (
        <Empty
          title="Nobody on the board yet"
          body="Discover your first dragon and the register begins."
        />
      ) : (
        <Panel className="divide-y divide-line">
          {board.entries.map((entry) => (
            <div
              key={`${entry.rank}-${entry.name}`}
              className={`flex items-center gap-3 p-3 ${entry.you ? "bg-verdigris/10" : ""}`}
            >
              <span className="num w-6 shrink-0 text-sm text-muted">{entry.rank}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {entry.name}
                {entry.you && <span className="eyebrow ml-2 text-verdigris">you</span>}
              </span>
              <span className="num shrink-0 text-xs text-muted">
                {entry.discovered} found
              </span>
            </div>
          ))}
        </Panel>
      )}

      {account && profile && (
        <Panel className="p-3">
          <p className="eyebrow">Your standing</p>
          <p className="mt-1 text-sm">
            {profile.discovered} discovered
            {profile.rank !== null
              ? ` · ranked ${profile.rank}`
              : " · not in the top ten yet"}
          </p>
          {profile.chosen && (
            <div className="mt-2.5">
              <p className="text-[11px] text-muted">
                {profile.anonymous || !profile.displayName
                  ? "You appear as Anonymous."
                  : `You appear as “${profile.displayName}”.`}
              </p>
              <div className="mt-2">
                <NameControls onDone={setBoard} notify={notify} label="Change" />
              </div>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function NamePrompt({
  rank,
  onDone,
  notify,
}: {
  rank: number;
  onDone: (board: BoardReply) => void;
  notify: (text: string, ok?: boolean) => void;
}) {
  return (
    <Panel className="border-verdigris/50 p-4">
      <p className="eyebrow text-verdigris">you have reached the top ten</p>
      <p className="mt-1 font-display text-base">Ranked {rank}</p>
      <p className="mt-1.5 text-sm text-muted">
        The board is public. You can stay anonymous, or pick a name to appear under —
        asked once, changeable later.
      </p>
      <div className="mt-3">
        <NameControls onDone={onDone} notify={notify} label="Use this name" />
      </div>
    </Panel>
  );
}

function NameControls({
  onDone,
  notify,
  label,
}: {
  onDone: (board: BoardReply) => void;
  notify: (text: string, ok?: boolean) => void;
  label: string;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (anonymous: boolean) => {
    setBusy(true);
    const result = await saveProfile(anonymous, anonymous ? null : name);
    setBusy(false);
    if (!result.profile) {
      notify("Could not reach the server.", false);
      return;
    }
    onDone(result);
    notify(
      result.profile.anonymous
        ? "You will appear as Anonymous."
        : `You will appear as “${result.profile.displayName}”.`,
    );
  };

  return (
    <div className="space-y-2">
      <input
        value={name}
        maxLength={NAME_MAX}
        placeholder="A name for the board"
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="solid"
          disabled={busy || name.trim().length === 0}
          onClick={() => void submit(false)}
        >
          {label}
        </Button>
        <Button disabled={busy} onClick={() => void submit(true)}>
          Stay anonymous
        </Button>
      </div>
    </div>
  );
}
