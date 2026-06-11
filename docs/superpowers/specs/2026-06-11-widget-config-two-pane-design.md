# Widget Configuration Page — Two-Pane Layout Redesign

**Date:** 2026-06-11
**Status:** Approved
**Scope:** Layout-only refactor of `src/components/DashboardPage.tsx`. No changes to data flow, URL generation, badge logic, preview behavior, or any API.

## Problem

The widget configuration page (`/dashboard`, rendered by `DashboardPage.tsx`) is a single narrow column (`max-w-lg`) of seven stacked cards. The user must scroll past every setting to reach the URL and preview, and the preview scrolls out of view while adjusting settings — so there is no way to tweak a setting and see its effect at the same time.

## Goal

A desktop-first two-pane layout: configuration on the wider left pane, the URL + live preview on a sticky right pane so the preview stays visible while settings are changed. This page is only meaningfully used on PC (it produces an OBS Browser Source URL), so the desktop experience is the priority; mobile must degrade gracefully but is not optimized.

## Layout

```
┌─────────────────────────────────────────────┐
│            채팅 위젯 설정  (header)            │   full width
├───────────────────────────┬─────────────────┤
│  CONFIG (left, 1.7fr)      │ OUTPUT (1fr)    │
│  ┌──────────┬──────────┐   │  ┌───────────┐  │
│  │ 뱃지 모드 │ 글자 크기 │   │  │ 미리보기   │  │  ← sticky
│  ├──────────┼──────────┤   │  ├───────────┤  │
│  │ 버튼 선택 │ 페이드아웃 │   │  │ 위젯 URL  │  │
│  └──────────┴──────────┘   │  ├───────────┤  │
│                            │  │ ▸ OBS 설정 │  │
├───────────────────────────┴─────────────────┤
│        로그아웃 / ← 돌아가기  (footer)         │   full width
└─────────────────────────────────────────────┘
```

- **Container:** widen from `max-w-lg` to `max-w-5xl`.
- **Outer grid:** `lg:grid lg:grid-cols-[1.7fr_1fr]` with a gap. Header and footer span the full width (outside the two-column grid, or via `lg:col-span-2`).
- **Left pane (config):** `grid grid-cols-1 sm:grid-cols-2` gap grid holding the four config cards. Default grid alignment (cards stretch to uniform row height) for clean rows.
- **Right pane (output):** `lg:sticky lg:top-8 self-start` so preview + URL stay in view while the left pane scrolls.

## Section changes

| Section | Change |
|---|---|
| 위젯 미리보기 | Move to **top of right pane** (above URL). Logic unchanged: `<WidgetPreview badgeMode fontSize />`. |
| 위젯 URL | Move to right pane, below preview. Keep input + 복사 button + "위젯 열기" link. |
| OBS 설정 방법 | Extract from the URL card into its own collapsible `<details>` in the right pane, **collapsed by default**. |
| 뱃지 모드 | Unchanged internally. Repositioned into left grid (cell 1). |
| 글자 크기 | Unchanged internally. Repositioned into left grid (cell 2). |
| 버튼 선택 모드 | Unchanged internally. Repositioned into left grid (cell 3). |
| 페이드아웃 | Unchanged internally. Repositioned into left grid (cell 4). |
| 연결 상태 | **Deleted entirely**, including the `hasTokens` / `isConnected` alert blocks. |
| 로그아웃 / 돌아가기 | Unchanged. Full-width footer below both panes. |

### Connection-status removal detail

The `연결 상태` card and its two alert blocks (`!data.hasTokens` re-login warning, `hasTokens && !isConnected` waiting notice) are removed. Rationale: the page is only reachable when already authenticated — `DashboardPage` redirects to `/login?next=/dashboard` on a 401 from `/api/channel`. The status card added vertical noise without actionable value for the logged-in streamer.

The `/api/channel` fetch and the `ChannelData` shape are **unchanged** — `data.widgetUrl` is still required for URL generation, and the `data == null` loading state still gates rendering. The now-unused `isConnected` / `hasTokens` fields simply stop being rendered.

## Responsive behavior

- Below `lg`: the two panes collapse to a single column. Sticky positioning is inactive (the `lg:` prefix scopes it to desktop).
- Below `sm`: the left config grid collapses to a single column.
- **Mobile stacking order:** config first, then output. (DOM order = left pane then right pane, which yields config-first naturally on collapse.)

## Out of scope

- No change to preview behavior. It still reflects only badge mode + font size; `buttonSel` and `fadeout` remain non-previewed (not meaningfully previewable with fake chat data).
- No change to `getWidgetUrl`, copy/clipboard logic, badge mode logic, or any API route.
- No new shared components required. Optional internal cleanup (extracting the right pane's JSX into a local helper for readability) is allowed but not required, as long as behavior is identical.

## Acceptance criteria

1. On a desktop viewport, config cards appear in a 2-column grid on the left; preview + URL + collapsible OBS guide appear on the right and remain visible (sticky) while scrolling the left pane.
2. The 연결 상태 card and both status alerts no longer render.
3. The OBS instructions are collapsed by default and expandable.
4. Changing badge mode / font size still live-updates both the preview and the generated URL.
5. The 복사 button and "위젯 열기" link still work.
6. On a narrow viewport the layout collapses to a single column (config first, then output) with no overflow.
7. Existing tests pass; lint/format clean.
