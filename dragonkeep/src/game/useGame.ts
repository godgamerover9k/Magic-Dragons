"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cloudEnabled, supabase } from "@/lib/supabase";
import { currentAccount, loadCloudSave, writeCloudSave, type Account } from "./cloud";
import { defaultContentPack } from "./content";
import { newGame, settle, type ActionResult } from "./engine";
import {
  clearAll,
  loadPack,
  loadSave,
  migrateSave,
  savePack,
  writeSave,
} from "./storage";
import type { ContentPack, SaveGame } from "./types";

export interface Toast {
  id: number;
  text: string;
  ok: boolean;
}

export function useGame() {
  const [pack, setPack] = useState<ContentPack>(() => defaultContentPack());
  const [save, setSave] = useState<SaveGame | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const toastId = useRef(0);
  const packRef = useRef(pack);
  packRef.current = pack;

  const notify = useCallback((text: string, ok = true) => {
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, text, ok }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3200);
  }, []);

  /**
   * Picks the save to play. A cloud save always wins if one exists, because it
   * is the one that follows the player between devices. If the account is new
   * and there is local progress, that progress is pushed up rather than lost.
   */
  const adoptSave = useCallback(
    async (loadedPack: ContentPack, signedIn: boolean) => {
      const local = loadSave();
      if (!signedIn) return local ? migrateSave(loadedPack, local) : newGame(loadedPack);

      const cloud = await loadCloudSave();
      if (cloud) return migrateSave(loadedPack, cloud);

      const starting = local ? migrateSave(loadedPack, local) : newGame(loadedPack);
      await writeCloudSave(starting);
      return starting;
    },
    [],
  );

  // Boot: content pack, then account, then save.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loadedPack = loadPack();
      const acct = cloudEnabled ? await currentAccount() : null;
      const chosen = await adoptSave(loadedPack, Boolean(acct));
      if (cancelled) return;
      setPack(loadedPack);
      setAccount(acct);
      setSave(settle(loadedPack, chosen));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [adoptSave]);

  // Follow sign-in, sign-out and guest conversion.
  useEffect(() => {
    const client = supabase();
    if (!client) return;
    const { data } = client.auth.onAuthStateChange(async (event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED")
        return;
      const acct = await currentAccount();
      setAccount(acct);
      if (event === "SIGNED_IN") {
        const chosen = await adoptSave(packRef.current, Boolean(acct));
        setSave(settle(packRef.current, chosen));
      }
    });
    return () => data.subscription.unsubscribe();
  }, [adoptSave]);

  // Clock for pending coins, food and incubation.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Local autosave, fast.
  useEffect(() => {
    if (!ready || !save) return;
    const t = setTimeout(() => writeSave(save), 400);
    return () => clearTimeout(t);
  }, [save, ready]);

  // Cloud autosave, slower — one write every few seconds at most.
  useEffect(() => {
    if (!ready || !save || !account) return;
    setSyncing(true);
    const t = setTimeout(async () => {
      await writeCloudSave(save);
      setSyncing(false);
    }, 2500);
    return () => clearTimeout(t);
  }, [save, ready, account]);

  useEffect(() => {
    if (!ready) return;
    savePack(pack);
  }, [pack, ready]);

  // Flush on the way out so nothing is lost on a tab close.
  useEffect(() => {
    const flush = () => {
      if (save) writeSave(save);
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [save]);

  const act = useCallback(
    (fn: (save: SaveGame) => ActionResult, quiet = false) => {
      setSave((current) => {
        if (!current) return current;
        const result = fn(current);
        if (!quiet || !result.ok) notify(result.message, result.ok);
        return result.ok ? result.save : current;
      });
    },
    [notify],
  );

  const patchSave = useCallback((fn: (save: SaveGame) => SaveGame) => {
    setSave((current) => (current ? fn(current) : current));
  }, []);

  const refreshAccount = useCallback(async () => {
    setAccount(await currentAccount());
  }, []);

  const resetProgress = useCallback(() => {
    setSave(newGame(pack));
    notify("New keeper started.");
  }, [pack, notify]);

  const resetEverything = useCallback(() => {
    clearAll();
    const fresh = defaultContentPack();
    setPack(fresh);
    setSave(newGame(fresh));
    notify("Game and content reset to the base set.");
  }, [notify]);

  const settleNow = useCallback(() => {
    setSave((current) => (current ? settle(pack, current) : current));
  }, [pack]);

  return useMemo(
    () => ({
      pack,
      setPack,
      save,
      setSave,
      account,
      refreshAccount,
      cloudEnabled,
      syncing,
      now,
      ready,
      toasts,
      notify,
      act,
      patchSave,
      resetProgress,
      resetEverything,
      settleNow,
    }),
    [
      pack,
      save,
      account,
      refreshAccount,
      syncing,
      now,
      ready,
      toasts,
      notify,
      act,
      patchSave,
      resetProgress,
      resetEverything,
      settleNow,
    ],
  );
}

export type Game = ReturnType<typeof useGame>;
