# Class-based DJ mode selection

**Date:** 2026-06-08
**Status:** Approved, ready for planning

## Summary

Change how a streamer's displayed button mode is chosen during V-ARCHIVE sync.
Today the winning button is the one with the **highest DJ POWER** (`djPowerConversion`).
This changes it to the one with the **highest DJ CLASS**, with deterministic
tie-breaking by button. DJ POWER is no longer used for ordering, except as the
trigger for the "theory" (이론치) super-rank.

This is a single-function change to the sync-time reducer. No schema change, no API
change, no widget/rendering change.

## Background: two storage questions that turned out to need no work

This spec emerged from three checks. Two require no implementation and are recorded
here so the conclusions are not re-litigated later:

- **Viewer DJ-class storage is already global per person, not per channel.** The chat
  overlay reads the *sender's* chzzk identity from each message
  (`WidgetPage.tsx`), looks it up via `/api/widget/dj-class?chzzkId=…`, which resolves
  `users` by chzzk identity and `dj_classes` by `user_id`. Both server cache
  (`id:${chzzkId}`) and client cache (`senderId`) are keyed by the viewer's identity.
  `channelId` only selects which chat stream to connect to — it never scopes the badge
  lookup. So a linked viewer's class is stored once and reused across every channel.
  Nothing to merge.

- **Prisma is not adopted.** The project uses `better-sqlite3` directly with
  hand-written SQL and a manual migration runner (`src/lib/db.ts`). For a 4-table,
  synchronous, Docker-deployed app this is the better fit; Prisma would add a
  query-engine binary and async overhead for marginal benefit. No change.

## The change

### Current behavior

`getHighestDjClass(nickname)` in `src/lib/varchive.ts` fetches all four buttons
(4, 5, 6, 8) concurrently, keeps the ones that returned a class, and reduces:

```ts
return results.reduce((best, current) =>
  current.djPowerConversion > best.djPowerConversion ? current : best
)
```

All four buttons' data is already in hand at this point. Only the reducer changes.

### New behavior

Pick the button with the greatest **class**, ordered by this key (first difference wins):

| Priority | Key | Order (best → worst) |
|---|---|---|
| 1 | **Theory** — DJ class is `THE LORD OF DJMAX` AND `djPowerConversion >= THEORY_POWER_THRESHOLD` (10000) | theory beats non-theory |
| 2 | **Rank** | LoD > BM > SS > HL > TS > PRO > HC > PD > MM > SD > RK > AM > TR > BG |
| 3 | **Level** within a rank | I > II > III > IV (null for LoD / BEGINNER) |
| 4 | **Button** (only on exact rank+level tie) | 8 > 5 > 6 > 4 |

"Same DJ class" for the button tie-break means **same rank AND same level** (e.g.
`SHOWSTOPPER II`). Different levels of the same rank are still ordered by level — only
an exact rank+level match falls through to the button order.

Power is used **only** to compute the theory flag. Two buttons at the same rank+level
are separated by button order, not by power.

## Where the code goes

### `src/lib/dj-class.ts` — owns rank semantics (single source of truth)

This file already holds `DJ_CLASS_COLORS`, `SHORT_NAMES`, `RANK_THRESHOLDS`,
`THEORY_POWER_THRESHOLD`, `parseRankName`, and `LEVEL_RE`. Add the ordering knowledge
here:

- `RANK_ORDER: string[]` — canonical rank names from best to worst. Explicit array
  (not reliance on object key order) so intent is unambiguous.
- A pure, exported function that returns a comparable sort key for one button result,
  e.g.:

  ```ts
  getClassSortKey(
    djClass: string,
    djPowerConversion: number | null | undefined,
    button: number
  ): [theory: number, rankOrdinal: number, levelOrdinal: number, buttonPref: number]
  ```

  - `theory`: 1 if `parseRankName(djClass) === 'THE LORD OF DJMAX'` and
    `isTheoryPower(djPowerConversion)`, else 0.
  - `rankOrdinal`: higher is better, derived from `RANK_ORDER` (unknown rank sorts
    lowest, alongside BEGINNER).
  - `levelOrdinal`: I=4, II=3, III=2, IV=1, none=0. Parsed via existing `LEVEL_RE`.
  - `buttonPref`: higher is better for the order 8 > 5 > 6 > 4 (so a larger number
    means "preferred"; e.g. map 8→3, 5→2, 6→1, 4→0).

  Comparison is lexicographic over the tuple, all descending (bigger wins at every
  position). The button term guarantees a total order, so the reducer is deterministic.

### `src/lib/varchive.ts` — uses the key in the reducer

Replace the `djPowerConversion` reducer in `getHighestDjClass` with one that compares
`getClassSortKey(...)` tuples and keeps the greater. Behavior when zero buttons return
a class is unchanged (`return null`).

## Testing (TDD)

`getClassSortKey` is pure — no DOM, no network — and is the unit-test target. Cases:

- Higher rank beats lower rank regardless of power (e.g. `SS IV` @ low power beats
  `HL I` @ high power).
- Same rank, different level: `SS I` beats `SS IV`.
- Exact rank+level tie resolves by button order: 8 > 5 > 6 > 4.
- Theory (`THE LORD OF DJMAX` @ ≥10000) beats plain `THE LORD OF DJMAX` @ <10000.
- Theory beats every non-LoD rank.
- LoD / BEGINNER (no level) compare correctly (levelOrdinal 0) without throwing.
- Unknown / unexpected class string sorts to the bottom rather than crashing.

A reducer-level test over a representative set of four button results confirms the
intended winner, including the documented behavior change below.

## Behavior change to be aware of

A streamer whose highest-**power** button differs from their highest-**class** button
will see a different badge than before. Example: `8B SHOWSTOPPER II` @ 9810 now wins
over `4B SHOWSTOPPER II` @ 9990 (today the 4B wins on power; now the 8B wins on the
button tie-break). This is intended.

## Out of scope

- No schema change; the single `dj_classes` row per user is unchanged.
- No widget, API, cache, or rendering change.
- No change to per-button display (we still store and show one winning button).
