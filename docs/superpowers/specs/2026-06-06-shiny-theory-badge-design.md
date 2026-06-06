# Shiny Theory Badge + Derived Theory + Page Margins

**Date:** 2026-06-06
**Status:** Approved (pending spec review)

## Overview

Three independent changes:

1. Replace the separate "이론치" (theory) badge with a *shiny* treatment on the
   existing DJ CLASS badge.
2. Remove the threaded `isTheory` boolean and derive it on the fly from
   `powerInteger`, centralized in one helper + constant.
3. Add top/bottom margin to all full web pages so content never sits flush
   against the top of the viewport.

The three are independent and can be implemented in any order, but 1 and 2 share
the `isTheoryPower()` helper, so 2 should land first or alongside 1.

---

## Change 1 — Theory badge → shiny LoD badge

### Rationale

A maxed/theory player (DJ power ≥ 10000) is always rank **THE LORD OF DJMAX
(LoD)** — LoD begins at 9980. So the player's DJ CLASS badge is already the LoD
pink→blue gradient. Rather than appending a second red badge, the theory state
animates that existing badge: a glossy glint sweeps across it. This also
distinguishes a *perfect* player (≥10000, shiny) from a *regular* LoD player
(9980–9999, static).

### Approved visual — Option A "Glossy glint sweep"

- Keep the badge's gradient background (LoD pink→blue for theory players).
- A diagonal translucent-white highlight sweeps left→right periodically.
- **Clip with `clip-path: inset(0 round 4px)`, NOT `overflow: hidden`.**
  `overflow: hidden` on an inline-block shifts its baseline to the bottom edge,
  which misaligns the badge against the chat text. `clip-path` clips the glint
  pseudo-element without affecting the baseline.

### Reference CSS (from the approved mockup)

```css
@keyframes glint {
  0%        { left: -60%; }
  55%, 100% { left: 130%; }
}
.shiny {
  position: relative;
  clip-path: inset(0 round 4px);   /* preserves baseline; clips the glint */
}
.shiny::after {
  content: '';
  position: absolute;
  top: 0; left: -60%;
  width: 40%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.85), transparent);
  transform: skewX(-20deg);
  animation: glint 2.6s ease-in-out infinite;
}
```

### Implementation

- Add a CSS module `src/components/dj-class-badge.module.css` containing the
  `@keyframes glint` and `.shiny` rules above.
- `DjClassBadge.tsx`: when the badge is theory (see Change 2 helper), add the
  `.shiny` class to the existing `<span>`. The inline gradient background is
  unchanged.
- `ChatMessageRow.tsx`: remove the `import TheoryBadge` and the
  `{message.isTheory && <TheoryBadge />}` line. The badge itself carries the
  shiny state now.
- **Delete** `src/components/TheoryBadge.tsx` and
  `src/components/theory-badge.module.css`.

---

## Change 2 — Remove `isTheory`, derive from `powerInteger`

### Rationale

`isTheory` is a pure derivation from a single field (`powerInteger >= 10000`) —
one integer comparison, nothing to cache. Today that rule is independently
re-derived in two API routes, hand-coded across 20 fake-message entries, and
threaded through `cache.ts` → API JSON → `ChatMessage` → `WidgetPage`
`CacheEntry`. Each is a place it can drift from `powerInteger`. Deriving at the
render site removes that drift entirely.

Flooring is safe: `floor(x) >= 10000 ⟺ x >= 10000` (the threshold is an integer),
so deriving from `powerInteger` is exactly equivalent to the current
`dj_power_conversion >= 10000` check — no behavior change.

### New helper (single source of truth)

In `src/lib/dj-class.ts`:

```ts
export const THEORY_POWER_THRESHOLD = 10000

export function isTheoryPower(powerInteger: number | null | undefined): boolean {
  return powerInteger != null && powerInteger >= THEORY_POWER_THRESHOLD
}
```

### Removals

Remove the `isTheory` field/computation from:

- `src/lib/cache.ts` — `CacheValue` type.
- `src/app/api/widget/dj-class/route.ts` — the `isTheory` computation and all
  occurrences in responses / cache writes (lines ~28, 86–88, 105, 112, 124).
- `src/app/api/user/me/route.ts` — the `isTheory` computation (line ~40) and the
  response field (line ~55).
- `src/components/ChatMessageRow.tsx` — `isTheory` in the `ChatMessage` interface.
- `src/components/WidgetPage.tsx` — `isTheory` in `CacheEntry` and all
  assignments (lines ~160, 172, 206, 226).
- `src/lib/fake-chat-messages.ts` — `isTheory` on all 20 entries.

### Threshold-mode text change

In `getBadgeText` (`src/lib/dj-class.ts`), `mode === 'threshold'`: when the badge
is theory, show the exact cap instead of the rank threshold.

- Theory (power ≥ 10000): `4B 10000` (no `+`).
- Otherwise: unchanged (`4B 9980+`, etc.).

`power` mode already shows `10000`; `short` mode shows `LoD` — both unchanged.

### Derivation at render

`DjClassBadge.tsx` (and anything deciding the shiny class) calls
`isTheoryPower(powerInteger)`. `fake-6` already has `powerInteger: 10000`, so the
preview's theory row keeps working.

---

## Change 3 — Full-page top/bottom margin

### Problem

Pages use `flex min-h-screen flex-col items-center justify-center px-4` with no
vertical padding. When content exceeds the viewport, `min-h-screen` lets the
container grow to content height, leaving `justify-center` no free space — so
content sits flush at the very top with no breathing room.

### Fix

Add `py-8 sm:py-12` to the `main`/wrapper of every full **web** page. Safe for
short pages (still centers) and gives margin on tall ones. The widget is **not**
touched.

Apply to:

- `src/components/LandingPage.tsx` (line ~10)
- `src/components/LinkPage.tsx` (line ~133)
- `src/components/DashboardPage.tsx` (line ~110 main; line ~99 error layout)
- `src/app/login/page.tsx` (line ~30)
- `src/app/not-found.tsx` (line ~6)

`SiteBackground.tsx` (`relative min-h-screen` wrapper) and `WidgetPage.tsx` are
left unchanged.

---

## Testing & docs

- Adjust/add `tests/` coverage:
  - Remove any assertions on `isTheory` or the deleted theory-badge markup.
  - Add a `getBadgeText` test: theory player in `threshold` mode → `4B 10000`.
  - Optional: a test for `isTheoryPower` boundaries (9999 → false, 10000 → true,
    null → false).
- Update `README.md`: the "이론치 뱃지" bullet — it is no longer a separate red
  badge; the LoD badge now shimmers when the player is theory (power ≥ 10000).

## Out of scope

- No DB schema change (`isTheory` was never a stored column).
- No change to widget layout, badge colors, or badge modes beyond the
  threshold-mode `10000` text.
