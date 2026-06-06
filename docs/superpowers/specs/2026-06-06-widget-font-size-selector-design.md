# Widget Chat Font-Size Selector — Design Spec

**Date:** 2026-06-06
**Status:** Approved (pre-implementation)

## Summary

Let the streamer choose the chat font size for their OBS widget. The
dashboard gains a slider; the chosen size is encoded in the widget URL as a
`fontSize` query parameter; the widget renders chat text **and** badges at that
size, scaling them together proportionally. A live preview reflects the chosen
size in real time.

## Goals

- Add a font-size slider to the dashboard widget-configuration page.
- Encode the selected size in the widget URL.
- Render the OBS widget at the selected size, with badges and message text
  scaling together.
- Reflect the selected size live in the existing dashboard preview.

## Non-Goals

- Per-user or per-message font sizes (the size is global to the widget URL,
  like `mode`).
- Font-family selection.
- Persisting the size server-side (it lives entirely in the URL, like `mode`).

## Scaling Model

The slider value is a **base font size in pixels** applied to the chat message
container. Today sizing is fixed: `ChatMessageRow` uses `text-sm` (14px) for
text and `DjClassBadge` uses `text-xs` for the badge; `TheoryBadge` has its own
fixed size.

Changes:

- The message container in `WidgetPage` and `WidgetPreview` sets
  `style={{ fontSize: <px> }}` on the scrolling message wrapper.
- `ChatMessageRow` drops the fixed `text-sm` class; its message text renders at
  `1em` (inherits the container base).
- `DjClassBadge` and `TheoryBadge` drop fixed `text-xs`; their font renders at
  `0.85em` so badges scale with the row but remain slightly smaller than the
  message text (preserving today's visual ratio of 12px badge / 14px text ≈
  0.857).
- Badge spacing (`mr-1`, `px-1`, `py-0.5`) stays in rem/Tailwind units so
  spacing stays consistent and does not balloon at large font sizes.

Net effect: moving the slider grows or shrinks the whole row uniformly.

## URL Parameter

- New query parameter: `fontSize` (integer pixels). Example:
  `/widget/<channelId>?mode=short&fontSize=18`.
- `getWidgetUrl()` in `DashboardPage` appends `fontSize` alongside `mode`,
  always present (matching the existing always-append behavior of `mode`).
- `WidgetPage` reads `fontSize` from the URL, parses and **clamps** it to the
  valid range, and falls back to the default if missing or invalid — mirroring
  the existing `mode` validation in `WidgetPage`.

### Range and default

- Range: **12–28 px**, step **1**.
- Default: **14 px** (matches today's fixed `text-sm`).

## Components and Changes

### New: `src/lib/font-size.ts`

A small, pure helper module so both the widget read-path and unit tests share
one source of truth:

- `FONT_SIZE_MIN = 12`, `FONT_SIZE_MAX = 28`, `FONT_SIZE_DEFAULT = 14`.
- `clampFontSize(value: number): number` — clamps into `[MIN, MAX]`.
- `parseFontSize(raw: string | null): number` — parses a URL param string,
  returns `FONT_SIZE_DEFAULT` for `null`/non-numeric/`NaN`, otherwise the
  clamped integer.

### New: `src/components/ui/slider.tsx`

shadcn-style wrapper over `@radix-ui/react-slider` (new dependency), consistent
with the existing `radio-group.tsx` / `label.tsx` wrappers.

### `src/components/DashboardPage.tsx`

- Add `fontSize` state (default `FONT_SIZE_DEFAULT`), alongside `badgeMode`.
- `getWidgetUrl()` appends `fontSize` to the URL.
- New card titled "글자 크기" containing the slider (12–28, step 1) and a live
  readout (e.g. "현재: 18px").
- Pass `fontSize` to `<WidgetPreview>`.

### `src/components/WidgetPreview.tsx`

- Accept a `fontSize` prop and apply it as the base `fontSize` on the message
  wrapper so the preview matches the chosen size live.

### `src/components/WidgetPage.tsx`

- Read `fontSize` from the URL via `parseFontSize` (in the same effect that
  reads `mode`), store it (ref or state), and apply it as the base `fontSize`
  on the message wrapper.

### `src/components/ChatMessageRow.tsx`

- Remove fixed `text-sm`; message text at `1em`.

### `src/components/DjClassBadge.tsx` and `src/components/TheoryBadge.tsx`

- Replace fixed `text-xs` font sizing with `0.85em`; keep spacing classes.

## Data Flow

```
DashboardPage (fontSize state)
  ├─ getWidgetUrl()  ──>  URL ?mode=&fontSize=  ──>  copied into OBS
  └─ <WidgetPreview fontSize> (live preview)

OBS Browser Source loads widget URL
  └─ WidgetPage  ──>  parseFontSize(url)  ──>  base fontSize on container
                       └─ ChatMessageRow (1em) + badges (0.85em) scale together
```

## Error Handling

- Invalid / missing `fontSize` in the URL → `FONT_SIZE_DEFAULT` (14).
- Out-of-range values (hand-edited URLs) → clamped to `[12, 28]`.

## Testing

- `tests/font-size.test.ts`: unit tests for `clampFontSize` and `parseFontSize`
  — covers below-min, above-max, in-range, `null`, non-numeric, float, and
  default fallback. Mirrors the existing lib-focused unit-test style
  (`tests/dj-class.test.ts`).
- No component/render tests are added (the suite is lib/server-focused today).

## Open Questions

None.
