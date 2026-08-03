"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { applyAction, type Action } from "./actions";
import { currentAccount, type Account } from "./cloud";
import { defaultContentPack } from "./content";
import { newGame, settle } from "./engine";
import { fetchRemoteSave, sendAction } from "./remote";
import { clearAll, loadPack, loadSave, migrateSave, savePack, writeSave } from "./storage";
import type { ContentPack, SaveGame } from "./types";

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
  const [pack, setPack] = useState<ContentPack>(() => defaultContentPack());
  const [save, setSave] = useState<SaveGame | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [now, setNow] = useState<number>(() => Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const toastId = useRef(0);

  const remote = Boolean(account);

  const notify = useCallback((text: string, ok = true) => {
    if (!text) return;
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, text, ok }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);

  const boot = useCallback(async () => {
    const loadedPack = loadPack();
    const acct = cloudEnabled ? await currentAccount() : null;

    if (acct) {
      const { save: fromServer, isAdmin: serverAdmin } = await fetchRemoteSave();
      return { loadedPack, acct, save: fromServer, serverAdmin };
    }

    // Local play. Admin is open here because it is the developer's own machine.
    const local = loadSave();
    const chosen = local ? migrateSave(loadedPack, local) : newGame(loadedPack);
    return {
      loadedPack,
      acct: null,
      save: settle(loadedPack, chosen),
      serverAdmin: !cloudEnabled,
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
    });
    return () => data.subscription.unsubscribe();
  }, [boot]);

  // Clock for banked coins, ovens and incubation.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Local play persists to the browser. Signed in, the server already has it.
  useEffect(() => {
    if (!ready || !save || remote) return;
    const t = setTimeout(() => writeSave(save), 400);
    return () => clearTimeout(t);
  }, [save, ready, remote]);

  useEffect(() => {
    if (!ready) return;
    savePack(pack);
  }, [pack, ready]);

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
        if (result.save) setSave(result.save);
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

  const resetEverything = useCallback(() => {
    clearAll();
    const fresh = defaultContentPack();
    setPack(fresh);
    if (!remote) setSave(newGame(fresh));
    notify("Content reset to the shipped pack.");
  }, [remote, notify]);

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
      now,
      ready,
      toasts,
      notify,
      act,
      resetEverything,
    }),
    [pack, save, account, isAdmin, remote, busy, now, ready, toasts, notify, act, resetEverything],
  );
}

export type Game = ReturnType<typeof useGame>;
