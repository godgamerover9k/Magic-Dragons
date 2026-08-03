"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { applyAction, type Action } from "./actions";
import { currentAccount, type Account } from "./cloud";
import { EMPTY_PACK } from "./emptyPack";
import { newGame, settle } from "./engine";
import type { RedactedPack } from "./redact";
import { bootstrap, sendAction } from "./remote";
import { loadSave, migrateSave, writeSave } from "./storage";
import type { SaveGame } from "./types";

export interface Toast {
  id: number;
  text: string;
  ok: boolean;
}

// Two modes, one set of rules.
//
//   Signed in  — the server owns the save. Every action is a request; the reply
//                is the new state. The client never writes progress anywhere.
//   Local play — no Supabase keys and no account, so the same dispatcher runs in
//                the browser against localStorage. For development, and for
//                anyone running this themselves.

export function useGame() {
  // Starts empty. The browser bundle contains no dragons at all; everything
  // below arrives from the server, already filtered to what has been unlocked.
  const [pack, setPack] = useState<RedactedPack>(EMPTY_PACK);
  const [save, setSave] = useState<SaveGame | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  // Whether the last thing we asked the server actually got there.
  const [connected, setConnected] = useState(true);
  const toastId = useRef(0);

  const remote = Boolean(account);

  const notify = useCallback((text: string, ok = true) => {
    if (!text) return;
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, text, ok }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);

  const boot = useCallback(async () => {
    const acct = cloudEnabled ? await currentAccount() : null;
    const server = await bootstrap();
    const loadedPack = server.pack ?? EMPTY_PACK;

    // Signed in: the server holds the save and sent it.
    if (acct && server.save)
      return {
        loadedPack,
        acct,
        save: server.save,
        serverAdmin: server.isAdmin,
        reachable: server.reachable,
      };

    // Local play, or signed out. The save lives in this browser, but the pack
    // still came from the server.
    const local = loadSave();
    const chosen = local ? migrateSave(loadedPack, local) : newGame(loadedPack);
    return {
      loadedPack,
      acct,
      save: settle(loadedPack, chosen),
      serverAdmin: server.isAdmin,
      reachable: server.reachable,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await boot();
      if (cancelled) return;
      setPack(result.loadedPack);
      setAccount(result.acct);
      setIsAdmin(result.serverAdmin);
      setSave(result.save);
      setConnected(result.reachable);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [boot]);

  // Follow sign-in, sign-out and guest conversion.
  useEffect(() => {
    const client = supabase();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange(async (event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED")
        return;
      const result = await boot();
      setAccount(result.acct);
      setIsAdmin(result.serverAdmin);
      setSave(result.save);
      setConnected(result.reachable);
    });
    return () => data.subscription.unsubscribe();
  }, [boot]);

  // Clock for banked coins, ovens and incubation.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The browser knows about its own connection before any request fails.
  useEffect(() => {
    const drop = () => setConnected(false);
    const restore = () => setConnected(true);
    window.addEventListener("offline", drop);
    window.addEventListener("online", restore);
    return () => {
      window.removeEventListener("offline", drop);
      window.removeEventListener("online", restore);
    };
  }, []);

  // Local play persists to the browser. Signed in, the server already has it.
  useEffect(() => {
    if (!ready || !save || remote) return;
    const t = setTimeout(() => writeSave(save), 400);
    return () => clearTimeout(t);
  }, [save, ready, remote]);

  /**
   * Runs an action. Signed in, it goes to the server and the reply replaces the
   * save — so a refusal leaves the player exactly where the server says they
   * are, not where their browser thought they were.
   */
  const act = useCallback(
    async (action: Action, quiet = false): Promise<SaveGame | null> => {
      if (remote) {
        setBusy(true);
        const result = await sendAction(action);
        setBusy(false);
        setConnected(!result.offline);
        if (result.save) setSave(result.save);
        // Discovering something widens what the server is willing to send.
        if (result.pack) setPack(result.pack);
        if (!quiet || !result.ok) notify(result.message, result.ok);
        return result.ok ? result.save : null;
      }

      let outcome: SaveGame | null = null;
      setSave((current) => {
        if (!current) return current;
        const result = applyAction(pack, current, action, {
          now: Date.now(),
          rng: Math.random,
          isAdmin,
        });
        if (!quiet || !result.ok) notify(result.message, result.ok);
        if (!result.ok) return current;
        outcome = result.save;
        return result.save;
      });
      return outcome;
    },
    [remote, pack, isAdmin, notify],
  );

  const reload = useCallback(async () => {
    const result = await boot();
    setPack(result.loadedPack);
    setAccount(result.acct);
    setIsAdmin(result.serverAdmin);
    setSave(result.save);
    setConnected(result.reachable);
    notify(
      result.reachable ? "Reloaded from the server." : "Could not reach the server.",
      result.reachable,
    );
  }, [boot, notify]);

  return useMemo(
    () => ({
      pack,
      setPack,
      save,
      account,
      isAdmin,
      cloudEnabled,
      remote,
      busy,
      connected,
      now,
      ready,
      toasts,
      notify,
      act,
      reload,
    }),
    [pack, save, account, isAdmin, remote, busy, connected, now, ready, toasts, notify, act, reload],
  );
}

export type Game = ReturnType<typeof useGame>;
