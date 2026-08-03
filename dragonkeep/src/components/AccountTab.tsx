"use client";

import { useState } from "react";
import {
  convertGuestToEmail,
  convertGuestToGoogle,
  signInAsGuest,
  signInWithEmail,
  signInWithGoogle,
  signOut,
  signUpWithEmail,
} from "@/game/cloud";
import type { Game } from "@/game/useGame";
import { Button, Field, Panel, SectionHeading } from "./ui";

export function AccountTab({ game }: { game: Game }) {
  const { account, cloudEnabled, busy: syncing, notify } = game;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await fn();
      notify(success);
    } catch (err) {
      notify((err as Error).message, false);
    } finally {
      setBusy(false);
    }
  };

  if (!cloudEnabled) {
    return (
      <div className="space-y-3">
        <SectionHeading label="Account" />
        <Panel className="p-4">
          <p className="font-display text-base">Playing on this device only</p>
          <p className="mt-1.5 text-sm text-muted">
            Accounts are switched off because the app has no Supabase keys. Progress
            still saves, but only in this browser — clearing site data ends the run.
          </p>
          <p className="mt-2.5 text-[11px] text-muted">
            To switch them on, follow the account setup steps in the README and set
            NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
          </p>
        </Panel>
      </div>
    );
  }

  // --- Signed out ----------------------------------------------------------
  if (!account) {
    return (
      <div className="space-y-3">
        <SectionHeading label="Account" />

        <Panel className="p-4">
          <p className="font-display text-base">Play as a guest</p>
          <p className="mt-1.5 text-sm text-muted">
            Start immediately, no details needed. Your progress saves to the cloud and
            you can turn this into a full account later without losing anything.
          </p>
          <div className="mt-3">
            <Button
              variant="solid"
              size="md"
              disabled={busy}
              onClick={() => run(signInAsGuest, "Guest keeper created.")}
            >
              Start as guest
            </Button>
          </div>
        </Panel>

        <Panel className="p-4">
          <p className="font-display text-base">Sign in</p>
          <div className="mt-3 space-y-2">
            <Field label="Email">
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password" hint="At least 6 characters.">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="solid"
                disabled={busy || !email || !password}
                onClick={() => run(() => signInWithEmail(email, password), "Welcome back.")}
              >
                Sign in
              </Button>
              <Button
                disabled={busy || !email || !password}
                onClick={() =>
                  run(
                    () => signUpWithEmail(email, password),
                    "Account created — check your email to confirm it.",
                  )
                }
              >
                Create account
              </Button>
            </div>
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <Button disabled={busy} onClick={() => run(signInWithGoogle, "Opening Google…")}>
              Continue with Google
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  // --- Signed in -----------------------------------------------------------
  return (
    <div className="space-y-3">
      <SectionHeading
        label="Account"
        aside={
          <span className="eyebrow">{syncing ? "saving…" : "saved to cloud"}</span>
        }
      />

      <Panel className="p-4">
        <p className="font-display text-base">
          {account.isGuest ? "Guest keeper" : account.email ?? "Signed in"}
        </p>
        <p className="mt-1 text-sm text-muted">
          {account.isGuest
            ? "Your progress is saved to the cloud, but this browser holds the only key to it. Clear your site data and it is gone for good."
            : "Your progress follows you to any device you sign in on."}
        </p>
        {account.providers.length > 0 && (
          <p className="eyebrow mt-2">via {account.providers.join(", ")}</p>
        )}
      </Panel>

      {account.isGuest && (
        <Panel className="p-4">
          <p className="font-display text-base">Keep this keeper permanently</p>
          <p className="mt-1.5 text-sm text-muted">
            Adding an email or Google account to this guest keeps every dragon, coin and
            codex entry exactly as it is. Nothing restarts.
          </p>

          <div className="mt-3 space-y-2">
            <Field label="Email">
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Choose a password" hint="At least 6 characters.">
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button
              variant="solid"
              disabled={busy || !email || password.length < 6}
              onClick={() =>
                run(
                  () => convertGuestToEmail(email, password),
                  "Check your email to confirm the address.",
                )
              }
            >
              Convert to an email account
            </Button>
          </div>

          <div className="mt-3 border-t border-line pt-3">
            <Button
              disabled={busy}
              onClick={() => run(convertGuestToGoogle, "Opening Google…")}
            >
              Convert using Google
            </Button>
          </div>
        </Panel>
      )}

      <Panel className="p-4">
        <p className="text-sm">Sign out</p>
        <p className="mt-1 text-xs text-muted">
          {account.isGuest
            ? "A guest cannot sign back in. Signing out abandons this keeper."
            : "Your progress stays in the cloud."}
        </p>
        <div className="mt-2.5">
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (
                account.isGuest &&
                !confirm("This guest keeper cannot be recovered. Sign out anyway?")
              )
                return;
              run(signOut, "Signed out.");
            }}
          >
            Sign out
          </Button>
        </div>
      </Panel>
    </div>
  );
}
