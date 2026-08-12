# Kerb UI Design System: "Paper on charcoal"

Status: ACTIVE since 2026-08-11. This sheet supersedes every earlier sheet in this file's history (the 2026-08-05 ember/charcoal sheet and the 2026-08-11 lime/ink-slate sheet are both retired).

Source of truth: three reference DOM dumps supplied at the repo root (`1page.txt` home, `2page.txt` net worth, `page3.txt` security page with options chain). Values marked `(ref)` were read directly from those dumps (inline styles, SVG attributes, gradient stops, animated inline transforms). Values marked `(derived)` fill gaps the dumps cannot carry (styled-components class CSS is not present in a DOM dump) and were chosen to sit inside the same language.

The design language: a warm near-black canvas, near-white ink, warm gray secondary ink, paper-white primary controls, one green for money-up, one blue for secondary data. No blur-glass, no gradient text, no neon. The luxury lives in motion (per-digit blur-morph tickers, sliding tab pills, pulsing chart cursor) and in restraint.

## 1. Color tokens

| Token | Value | Provenance | Role |
|---|---|---|---|
| `--bg` | `#0d0d0d` | (ref) chart area gradient bottom stop | page canvas |
| `--bg-elev` | `#161514` | (derived) | raised strips, sticky bars |
| `--card` | `#1a1918` | (derived, warm family of #32302f) | default card |
| `--card-hover` | `#21201e` | (derived) | card/row hover |
| `--well` | `#131211` | (derived) | inset wells, inputs, chart gutters |
| `--hairline` | `rgba(252,252,252,0.08)` | (derived) | default borders |
| `--hairline-strong` | `rgba(252,252,252,0.14)` | (derived) | table heads, emphasized separations |
| `--ink` | `#fcfcfc` | (ref) 900+ occurrences, icon and text fills | primary ink |
| `--ink-2` | `#c9c6c4` | (ref) muted icon color | secondary ink, muted icons |
| `--ink-3` | `#8f8b88` | (derived) | tertiary ink, captions |
| `--paper` | `#fcfcfc` | (ref) | primary button fill, paper cards |
| `--paper-warm` | `#f5f4f4` | (ref) | paper hover tint, warm paper surfaces |
| `--paper-press` | `#edebe9` | (derived) | paper pressed tint, one step past hover |
| `--on-paper` | `#0d0d0d` | (ref) brand chip fill on primary button | ink on paper |
| `--on-paper-2` | `#32302f` | (ref) icon fill on light marketing cards | soft ink on paper cards |
| `--up` | `#37bc65` | (ref) chart line stroke, up arrows | positive, money-up |
| `--up-deep` | `#409652` | (ref) area gradient top stop | chart area fill source |
| `--down` | `#e5544b` | (derived, no negative on captured pages) | negative, danger |
| `--data-blue` | `#5b88d9` | (ref) spend sparkline | secondary data series |
| `--focus` | `rgba(252,252,252,0.55)` | (derived) | focus ring color |

Rules. `--up` and `--down` are reserved for money and market movement plus destructive actions; never decorate with them. `--data-blue` is only a chart series color. Everything else is neutral warm.

## 2. Type

- Family: `"Instrument Sans", "Inter", system-ui, sans-serif` (derived stand-in; the reference uses a proprietary grotesque). Weights 400 / 500 / 600 only.
- All numerals that can change: `font-variant-numeric: tabular-nums`.
- Scale (px / weight / letter-spacing):
  - Display (hero balance): 44 / 500 / -0.01em, line-height 1.1
  - H1 (page title, "Bonjour"-tier): 24 / 600 / -0.01em
  - H2 (section title): 18 / 600 / 0
  - Row title: 15 / 600 / 0
  - Body: 14 / 400 / 0
  - Caption: 12.5 / 400 / 0, color `--ink-3`
  - Micro chip: 11 / 500 / 0.02em
- Currency style: amount in ink, unit suffix as a small muted chip beside it (the reference shows a small `USD` caption beside the price). Kerb keeps English formats: `2,847.39 XRP`, prices 6 decimals `2.847391`.

## 3. Surfaces and radii

- Page: flat `--bg`, no background gradients, no vignettes, no noise.
- Card: `--card`, radius 16, no border by default; hairline only when two cards touch.
- Feature/paper card: `--paper` with `--on-paper` text and `--on-paper-2` icons, radius 20. Used sparingly: marketing/education cards, the single loudest surface per screen.
- Well: `--well`, radius 12, inset (inputs, chart gutters, segmented tracks).
- Controls: full pill (radius 999) for every button and segmented control.
- Table rows: transparent, radius 10 on hover fill only.
- Shadows: none on dark surfaces (hierarchy by tone). Paper cards may carry `0 8px 24px rgba(0,0,0,0.35)` (derived).

## 4. Hairline grammar (Kerb-specific)

- Solid `--hairline`: a settled boundary (card edges, table heads).
- Dashed `--hairline-strong`: not-yet-settled money (pending fills, awaited FDC proof).
- The chain's money line: a special full-width row with solid hairlines top and bottom and a right-aligned chip; in Kerb this renders the live FTSO price inside the slice table ("Trigger line" pattern, from the reference's "En jeu" row).

## 5. Icons

- 16px grid (ref), filled paths that read as 1.8px rounded strokes (ref paths use 0.9 corner radii); nav icons 18px (ref); close/X 24px (ref); avatar/logo circles 24px, profile 32px (ref).
- Color `currentColor`; default `--ink-2`, active/hover `--ink`.
- Logo stacks overlap by 6px (ref: `width: calc(24px - 6px)` slots).

## 6. Signature motion

Base easing `cubic-bezier(0.2, 0, 0, 1)` (swift-out). Durations: 120 hover fades, 180 menus, 250 tab pill slide, 280 digit morph, 350 carousel, 1600 cursor pulse. `prefers-reduced-motion`: everything becomes opacity-only or static; tickers snap.

1. Per-digit blur-morph ticker (ref, measured mid-animation): each digit sits in its own cell holding an invisible ghost for width plus an absolutely positioned visible span. On change, only the changed digit animates: old span exits down `translateY(+8px)` gaining `blur(3px)` and fading to 0; new span enters from `translateY(-8px)` with blur decaying to 0; 280ms. Separators (comma, currency) never animate. The number container's width itself animates when digit count changes (ref: inline width transitions).
2. Sliding tab pill (ref): segmented controls are `role="tablist"` with an `aria-hidden` pill behind the buttons; the pill animates `width` and `transform: translateX()` (ref inline styles), 250ms; label color crossfades 150ms.
3. Chart cursor pulse (ref): endpoint dot = inner circle r 3.3 in series color + outer circle scaling r 3.3 to ~9 while fading to 0, 1600ms, infinite.
4. Halftone chart fill (ref): the area under a line is `linearGradient` (`--up-deep` at 32% alpha to transparent at the bg) masked by a 2x2 dot pattern of r=0.5 circles; the fill is dots, not a smooth wash. Line drawn twice: once at opacity 0.2 (glow), once full, both 1.5px.
5. Collapse (ref): sections animate height with content opacity trailing; chevron rotates 180deg, 200ms.
6. Star/watch toggle (ref structure): two stacked stars; the visible one scale-bounces 1 to 0.85 to 1.08 to 1 while filling; the aria-hidden twin bursts scale 1 to 1.8 fading out, 400ms.
7. Privacy toggle (ref feature): the eye button morphs every balance digit to a dot glyph through the same blur-morph.

## 7. Kerb signatures restyled

- Sealed strategy bar: `repeating-linear-gradient(90deg, rgba(252,252,252,0.16) 0 8px, transparent 8px 10px)`, height 0.95em, radius 2px, on `--well`.
- FDC proof seal chip: pill chip, 1px `--hairline-strong` border plus offset outline `1px solid --hairline` at 2px offset; verified state tints text `--up`.
- Trigger line row (from the reference money-line): live FTSO price with change percent and an "armed" chip inside the slice table.

## 7.5 Control anatomy (the machined key, 2026-08-12 detail pass)

Every filled control shares one three-layer recipe, tuned per fill, so buttons read as physical keys instead of flat pills:

- Self-colored edge: a 1px ring in the control's own family (`--hairline` on quiet fills, strengthening to `--hairline-strong` on hover; `rgba(--down, 0.22)` on danger; the paper key needs none, its value contrast is the edge).
- Inner top highlight: `inset 0 1px 0` (pure white on paper, `rgba(252,252,252,0.05)` on charcoal fills, `0.16` on the ink key) so the top lip catches the single overhead light.
- One tight downward shadow on solid keys only: `0 1px 2px` tinted to the surface below, never a wide bloom.

States, always all of them: hover shifts the fill one tonal step (`--paper` to `--paper-warm`; `--card` to `--card-hover`), press one more (`--paper-press`) plus `scale(0.98)`, disabled is 0.4 opacity with pointer events off, focus-visible keeps the global 2px `--focus` ring. Icons inside a button read one ink step softer than the label (`--on-paper-2` on paper, `--ink-2` on charcoal and ink fills); the brand `kchip` inverts on ink fills. Icon-button hovers are translucent (`rgba(252,252,252,0.07)`) so they read on any surface. Wells hover and focus to `--hairline-strong`. Status chips carry an honest self-colored border (`rgba(--up, 0.22)`), never an inner glow.

## 8. Components (canonical set)

Paper primary pill; quiet pill (`--card` fill); compact row pill; round icon button; menu trigger with chevron (`data-state` open/closed, menu pops 180ms scale 0.98 + rise 4px); text/icon segmented tabs with sliding pill; large Buy/Sell toggle; row-as-button; full-card invisible overlay link (whole card clickable via absolutely positioned anchor, ref pattern); bid/ask tinted order buttons (price + 16px plus icon; sell tint `--down` at 8%, buy tint `--up` at 8%, hover 16%); fake search field (button styled as input, ref); badge chips (green text chip, neutral "Beta"-style chip, tier pill image); ghost/suggested row with badge + compact pill + dismiss X; earnings-style day card with overlapping logo stack; empty states with one-line title, one-line body, one action.

## 9. Accessibility floor

Contrast: `--ink` on `--bg` about 17:1; `--ink-2` on `--bg` about 10:1; `--on-paper` on `--paper` about 17:1. Focus: 2px `--focus` outline, 2px offset, never removed. Tab semantics on segmented controls (`tablist`/`tab`/`aria-selected`), `aria-expanded` on collapses, `aria-haspopup` + `data-state` on menu triggers, `aria-label` on icon-only buttons. Hit areas 40px minimum. Reduced motion honored everywhere.

## 10. Never list

Never: background gradients or glows on the canvas; gradient or glass buttons; blur-glass panels; neon accents; more than one paper card cluster per screen; color-coded decoration; skeleton shimmer across whole screens (use quiet pulse); em or en dashes in UI copy (use "--" placeholders for empty numerics, faint ink); spinners where a digit morph or pulse can carry liveness.
