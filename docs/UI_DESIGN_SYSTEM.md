# Kerb UI design system (the per-project sheet)

The approved token sheet for every Kerb surface. Approved by the human on
2026-08-05 (direction: ember on warm charcoal, single dark theme). Every
rendered value traces here; `ui-design/palette.html` is the visual twin
attached to every Claude Design run.

## Register and house style

- Register: precision tools with calm-trust warmth (Linear discipline,
  Wealthsimple temperature). Single dark theme.
- House style in one line: a machined, warm-dark instrument panel where the
  only thing you cannot see is the strategy, and that invisibility is drawn.

## Palette (seven roles)

| Role | Token | Hex | Rule |
|---|---|---|---|
| Field | `--field` | `#0E0C0A` | page background; warm (R > G > B), never blue-slate |
| Surface | `--surface` | `#16130F` | raised panel, one step up |
| Surface 2 | `--surface-2` | `#1E1A15` | menus, hover, second step |
| Well | `--well` | `#0B0908` | recessed inputs and trays, inset shadow |
| Ink | `--ink` | `#F4F1EC` | primary text, never `#FFFFFF` |
| Muted ink | `--ink-muted` | `#A8A29E` | secondary text, holds 4.5:1 on field |
| Faint ink | `--ink-faint` | `#78716C` | labels, empty states, 3:1 large only |
| Accent | `--accent` | `#E86A33` | ALL interactivity; nothing else is saturated |
| Accent soft | `--accent-soft` | `#3A2418` | tinted fills |
| Accent deep | `--accent-deep` | `#8A3D1E` | pressed, rings |
| Reserved | `--proof` | `#2FA57C` | the FDC proof stamp ONLY, once per screen |
| Destructive | `--destructive` | `#C93B4E` | errors, cancel mandate |

Hairlines: solid `rgba(255,255,255,0.12)` = boundary; dashed
`rgba(255,255,255,0.07)` = itemized rows, meaning "not yet settled" (dashed
becomes solid when the row settles).

## Type

- Display: Technor (Fontshare, self-hosted woff2 via `next/font/local`).
- Body: Switzer (Fontshare, self-hosted).
- Data: Commit Mono (commitmono.com, self-hosted); mono is for data only
  (prices, hashes, addresses), never the house voice.
- Scale: 11 (eyebrow, 600, uppercase, 0.14em) / 12 (table meta) / 13 (table
  body) / 14 (prose) / 16 / 20 / 28 (page titles) / display
  `clamp(2.5rem, 1.8rem + 3.2vw, 4.5rem)`.
- Weight ceiling 500 on headings; 600 only on eyebrows. Sentence case
  everywhere. `font-variant-numeric: tabular-nums slashed-zero` on every
  number; right-aligned, fixed `ch` widths on live cells.

## Space and shape

- Spacing base 4px; card padding 20px; content max width 1060px, side
  padding 30px; sections breathe 96 to 160px on marketing, 24 to 32px in app.
- Radii: 4 (chips) / 8 (controls, wells) / 12 (cards) / 16 (trays, modals).
  Inner radius always smaller than its parent.

## Material and elevation (dark: edges, not shadows)

- Raised = surface one step lighter + 1px inside border `rgba(255,255,255,0.07)`.
- Recessed = `--well` + `inset 0 0 6px rgba(0,0,0,0.5)`.
- Overlay shadow only on modals: `0 16px 70px rgba(0,0,0,0.5)`.
- No card drop shadows, no glass, no gradients on surfaces.

## Motion tokens

- Durations: 70 (micro) / 120 (small) / 200 (standard) / 300 (large);
  400 only for the one hero move per screen.
- Easings: enter `cubic-bezier(0,0,0.2,1)`, exit `cubic-bezier(0.4,0,1,1)`,
  on-screen `cubic-bezier(0.4,0,0.2,1)`. Exits run ~20% shorter than enters.
- Stagger constant 40ms. Overshoot budget: one small bounce, spent only on
  the proof seal's appearance. Press scale 0.97.
- Live price tick: background tint flash at 10% alpha for 300ms, then fade;
  color the delta, never the whole price.
- `prefers-reduced-motion`: everything collapses to instant or opacity-only
  with an identical final composition. Content is visible by default; no
  entrance animation ever gates existence.

## Signature elements

1. **The redaction bar** (`.sealed`): every TEE-sealed value prints as a
   censored strip (`repeating-linear-gradient(90deg, faint 0 8px,
   transparent 8px 10px)`, height 0.95em, radius 2px, width proportional to
   the hidden value). Placement rule: appears only where a sealed value
   would print (review step, dashboard row, detail panel); never decorative.
   The create-flow review step animates cleartext to redaction in 400ms:
   the product's hero moment.
2. **The FDC proof seal**: a double-edged chip (1px `--proof` border plus a
   1px offset outline at 35% alpha), 10px mono uppercase "FDC attested".
   Placement rule: right-aligned on timeline events and settlement cells
   that carry an on-chain proof; its absence is information.
3. Hairline grammar (solid boundary / dashed pending) as the supporting
   system, applied everywhere.

## Hero moment

The mandate detail screen: a live FTSOv2 price thread crossing a hatched,
feathered occlusion band (you can see that a trigger zone exists, not where
the line is), above the sealed strategy panel made of redaction bars.

## Stack

Next.js latest, App Router, TypeScript, Bun only (`bunx create-next-app@latest
kerb-app --ts --app --use-bun`). Tokens as CSS variables in the global
stylesheet; components read tokens, never literals. Components live under
`src/components/<domain>/`. Status is typographic (6px dot + text), never a
pill. Icons: bare marks, one stroke width, no tiles behind them.
