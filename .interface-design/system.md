# SignalBrief — Interface Design System

## Intent
**Who:** Senior strategy consultant. 6:45am, coffee, 20 minutes before first call. Smart, pattern-seeking, time-poor. Reads Bloomberg, FT, The Economist.
**Task:** Scan 7 signals in under 3 minutes. Know which ones matter today.
**Feel:** Intelligence briefing from a trusted analyst. Editorial authority. Dense but readable. Not a SaaS tool — a premium information product.

## Domain
Financial newswires, morning briefings, printed strategy memos, executive dashboards. Colors that belong: deep navy (Reuters/Bloomberg), newsprint cream, ink black, amber/gold of premium financial data, warm grey of FT Weekend.

## Signature
The blue left-border accent on lead stories (`border-left: 3px solid var(--accent)`) — the visual signal that one story matters most. Applied on: archive detail lead item, quick-scan box. This is the hierarchy made physical.

## Depth Strategy
**User-facing pages** (index, settings, archive): borders + subtle shadows. Cards feel lifted and approachable.
**Admin page**: borders-only. Technical, dense tool — no shadows needed.
**Never mix** these strategies within a single page type.

## Token System

```css
:root {
  /* Surfaces */
  --bg: #FAFAF8;          /* page canvas — warm off-white */
  --card: #FFFFFF;        /* card surfaces */
  --bg-input: #F5F6F8;    /* inset inputs — darker than card = "receive content" */

  /* Text — 4 levels */
  --text: #111111;        /* primary — headlines, key values */
  --text-2: #374151;      /* secondary — body copy, WIM text */
  --text-muted: #6B7280;  /* tertiary — supporting info, secondary labels */
  --text-light: #9CA3AF;  /* muted — placeholders, disabled, metadata */

  /* Brand */
  --accent: #2563EB;
  --accent-hover: #1D4ED8;
  --accent-light: #EFF6FF;

  /* Borders — hierarchy from card edge → in-card separator */
  --border: rgba(0,0,0,0.08);       /* card edges, input outlines */
  --border-subtle: rgba(0,0,0,0.05); /* in-card row separators */
  --border-focus: #2563EB;          /* interactive focus */

  /* Shadows — user-facing pages only */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06);

  /* Semantic */
  --green: #059669;
  --yellow: #D97706;
  --red: #DC2626;
}
```

## Spacing
Base unit: 4px. Common scale: 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Micro (icon gaps): 4–8px
- Component (button padding, chip padding): 8–16px
- Section internal (card padding): 24–32px
- Major separation (between sections): 36–48px

## Typography
- **Instrument Serif** — headlines, titles, brand wordmark. Letter-spacing: -0.3 to -0.5px. For presence and editorial authority.
- **DM Sans** — all UI text. -apple-system fallback. For clarity and density.
- **ui-monospace** — data values, timestamps, cost figures, tokens. Tabular numbers.

Hierarchy in practice:
- Page titles: Instrument Serif 28–36px, weight 400
- Card titles / section headers: Instrument Serif 22px or DM Sans 17px 600
- Body / WIM text: DM Sans 14px, color --text-2
- Labels / metadata: DM Sans 11–13px, color --text-muted
- Microlabels (ALL CAPS): 10–11px, weight 700, letter-spacing 0.06–0.08em

## Component Patterns

### Cards
```css
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-md);  /* user-facing only; omit in admin */
  padding: 20–32px;
}
```

### Inputs (inset feel)
```css
input, select {
  background: var(--bg-input);   /* darker than card = visually recessed */
  border: 1.5px solid var(--border);
  border-radius: 8px;
}
input:focus, select:focus {
  background: #fff;              /* lift on focus */
  border-color: var(--border-focus);
}
```

### Topic Chips
- Standard: white bg, `--border` edge, `--text-muted` label
- Hover: `--accent-light` bg, accent border
- Selected: accent bg, white text
- **Custom (user-added)**: amber treatment — `background: #FFFBEB`, `color: #92400E`, `border-color: rgba(217,119,6,0.35)`. Selected: `background: #D97706`. Rationale: amber = "yours", not the system's. Fits financial intelligence domain.
- Class on settings.html: `.chip.chip-custom` | Class on index.html: `.topic-chip.topic-chip-custom`

### In-card row separators
Use `--border-subtle` (not `--border`) for rows inside a card. Card edge and row divider must read as different intensities.

### Table rows (admin)
- `thead th`: `background: rgba(0,0,0,0.02)` — barely-there header tint
- `tbody td border-bottom`: `1px solid var(--border-subtle)`
- Row hover: `background: rgba(0,0,0,0.015)`

### Lead item indicator
```css
.item-lead {
  border-left: 3px solid var(--accent);
  padding-left: 16px;
}
```
Used in: archive detail view, email template. This is the signature element.

### Quick-scan / editorial callout box
```css
.scan-box {
  background: rgba(0,0,0,0.025);
  border: 1px solid var(--border-subtle);
  border-left: 3px solid rgba(37,99,235,0.2);
  border-radius: 0 8px 8px 0;
  font-style: italic;
  color: var(--text-2);
}
```

### Admin action buttons
```css
.btn-action { border:none; border-radius:8px; padding:10px 20px; font-size:13px; font-weight:600; cursor:pointer; }
.btn-action-primary { background:var(--accent); color:#fff; }
.btn-action-teal { background:#0F766E; color:#fff; }
.btn-secondary { background:var(--card); border:1.5px solid var(--border); color:var(--accent); }
```

## Dark Mode (index.html only)
```css
body.dark {
  --bg: #0F172A; --card: #1E293B;
  --text: #F1F5F9; --text-2: #CBD5E1; --text-secondary: #94A3B8;
  --border: rgba(255,255,255,0.08);   /* inverted rgba for dark surfaces */
  --border-subtle: rgba(255,255,255,0.05);
  --accent: #3B82F6; --accent-light: #1e3a5f;
}
```
Note: always use rgba borders so they work on both light and dark surfaces. Dark mode explicitly overrides `--border` with white-rgba.

## What to Keep
- Instrument Serif + DM Sans pairing — do not change
- Blue `#2563EB` as the single accent — do not add other accent colors
- Warm off-white `#FAFAF8` canvas — not pure white, not cool gray
- Day circle picker for frequency selection (better than multi-select checkboxes)
- Blue left-border on lead stories — the signature, never remove
