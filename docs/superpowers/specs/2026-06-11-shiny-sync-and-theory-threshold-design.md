# Shiny badge sync + theory threshold workaround — design

Date: 2026-06-11

Two independent fixes to the chat widget badge rendering:

1. The shiny (glint) animation on theory badges appears to restart from the
   beginning whenever new chat arrives and existing rows shift.
2. True in-game theory (이론치) players are not detected as theory, because
   V-ARCHIVE returns a `djPowerConversion` slightly under 10000.

## Problem 1 — Shiny animation restarts when chat moves

### Current behavior

`src/components/dj-class-badge.module.css` drives the glint with a mount-relative
CSS animation:

```css
.shiny::after {
  animation: glint 2.6s ease-in-out infinite;
}
```

Each badge's animation timeline starts whenever its element's animation begins.
When a new message arrives the list re-renders, and the glint visually restarts
from the start of its sweep.

### Approach — global wall-clock phase lock

Phase-lock every shiny badge to **absolute wall-clock time** instead of mount
time, using a negative `animation-delay` computed as `-(now % period)`. Because
the offset is derived from the clock rather than the element's lifetime, any
badge — newly mounted or re-mounted — lands on the same point in the cycle.
A re-mount recomputes the same phase, so the restart is no longer visible.

Accepted side effect (confirmed with user): all shiny badges glint in unison.

### Changes

1. `src/components/dj-class-badge.module.css` — drive duration and delay from
   CSS variables so JS can own them:
   ```css
   .shiny::after {
     animation: glint var(--glint-duration, 2.6s) ease-in-out infinite;
     animation-delay: var(--glint-delay, 0ms);
   }
   ```
2. `src/components/DjClassBadge.tsx` — when `shiny`, inject the CSS variables as
   an inline style on the `.shiny` element (the `::after` pseudo-element cannot
   take inline styles, so the variables are set on its parent):
   - `--glint-duration` derived from a single constant `GLINT_PERIOD_MS = 2600`
     (avoids a magic-number drift between CSS `2.6s` and the JS modulo).
   - `--glint-delay` = `` `-${Date.now() % GLINT_PERIOD_MS}ms` `` → wall-clock
     phase lock.
3. Hydration safety: the widget starts with `messages = []`, so no shiny badge
   exists in the SSR HTML and there is no hydration mismatch for the reported
   case. For components that may render a shiny badge during SSR
   (`WidgetPreview`, `LinkPage`/`LinkClassBadge`), set the delay after mount (or
   otherwise guard) so server and client markup agree. Final mechanism settled
   in the implementation plan.

## Problem 2 — Theory detection on raw djPowerConversion

### Current behavior

`src/lib/dj-class.ts` decides theory from the integer power:

```ts
export const THEORY_POWER_THRESHOLD = 10000
export function isTheoryPower(powerInteger) {
  return powerInteger != null && powerInteger >= THEORY_POWER_THRESHOLD
}
```

`powerInteger` is produced by `Math.floor(djPowerConversion)` in three places
(`api/widget/dj-class/route.ts`, `api/user/me/route.ts` ×2). A real theory score
that V-ARCHIVE reports as `9999.9847` floors to `9999` and fails the check.
`getClassSortKey` additionally checks the **raw** float against the same `10000`
threshold, so theory players are not picked as the displayed class either.

### Approach — detect on the raw float, bump the display integer

Make the raw `djPowerConversion` the single source of truth for theory, using a
lowered threshold of `9999.9847`. Display power as `10000` for theory players
(confirmed with user), which keeps the existing integer-based callers working
unchanged.

This is an explicit **temporary workaround** for a V-ARCHIVE calculation quirk
and will be marked as such in code comments so it is easy to revert.

### Changes (`src/lib/dj-class.ts`)

1. Add `THEORY_POWER_CONVERSION_THRESHOLD = 9999.9847`, commented as a temporary
   V-ARCHIVE workaround. Keep `THEORY_POWER_THRESHOLD = 10000` for display text.
2. Add `isTheoryConversion(conversion)` — `conversion != null && conversion >=
   THEORY_POWER_CONVERSION_THRESHOLD`. The source-of-truth detector for the raw
   float.
3. Add `toPowerInteger(conversion)` — returns `null` for null/undefined,
   `THEORY_POWER_THRESHOLD` (10000) when `isTheoryConversion` is true, otherwise
   `Math.floor(conversion)`. Replace the three `Math.floor(djPowerConversion)`
   call sites with this helper so the conversion lives in one place.
4. In `getClassSortKey`, change the raw-float theory check from
   `isTheoryPower(djPowerConversion)` to `isTheoryConversion(djPowerConversion)`
   so theory players sort to `levelOrdinal = 5` correctly.
5. Keep `isTheoryPower(powerInteger >= 10000)` as-is. `DjClassBadge` (shiny) and
   `getBadgeText` (threshold mode) receive the bumped integer `10000`, so they
   continue to work without change.

### Tests (`tests/dj-class.test.ts`)

Add boundary cases:
- `toPowerInteger(9999.9847) === 10000` (theory bump)
- `toPowerInteger(9999.5) === 9999` and not theory
- `toPowerInteger(9999.9846)` not theory (just under the threshold)
- a raw `9999.9847` is treated as theory by `getClassSortKey` (`levelOrdinal 5`,
  beats a plain LoD)
- existing assertions updated where they relied on `10000` being the only theory
  value

## Out of scope

- Investigating/fixing any React re-mount cause directly — the wall-clock phase
  lock makes the restart invisible regardless of cause. If the implementation
  reveals a clear re-mount bug, it can be noted but is not required for the fix.
- Changing V-ARCHIVE fetching or storage; `djPowerConversion` is stored as-is.
