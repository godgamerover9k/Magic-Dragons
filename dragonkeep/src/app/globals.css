@import "tailwindcss";

@theme {
  --color-ink: #12141c;
  --color-panel: #191c26;
  --color-raised: #20242f;
  --color-line: #2c3140;
  --color-bone: #e8e5dc;
  --color-muted: #888ea1;
  --color-verdigris: #5fa98a;
  --color-verdigrisdim: #3c6b58;
  --color-warn: #c8536b;

  --font-display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Public Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
}

html,
body {
  background: var(--color-ink);
  color: var(--color-bone);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  overscroll-behavior-y: none;
}

/* Numerals are data here, so they get the utility face and tabular figures. */
.num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--color-muted);
}

/* The cladogram connector rules -- the Codex signature device. */
.branch::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-line);
}

.branch-tick::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0.95rem;
  width: 0.75rem;
  height: 1px;
  background: var(--color-line);
}

button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--color-verdigris);
  outline-offset: 2px;
}

input,
select,
textarea {
  background: var(--color-ink);
  border: 1px solid var(--color-line);
  border-radius: 0.25rem;
  padding: 0.4rem 0.55rem;
  color: var(--color-bone);
  font-size: 0.875rem;
  width: 100%;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-thumb {
  background: var(--color-line);
  border-radius: 4px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
