/* Global Alpine component registrations (run before Alpine starts, via alpine:init).
   Registering with Alpine.data() — instead of per-page inline <script>s — means the
   components are available after htmx content swaps, and lets all scripts live
   in <head>. */

/* hx-boost history: htmx's default history cache snapshots the LIVE #content
   innerHTML — including Alpine-generated rows and a running widgetPreview — and
   restores that stale snapshot on back/forward WITHOUT firing htmx:afterSettle.
   That left the preview frozen/duplicated after a few back-and-forths. Disabling
   the cache makes back/forward re-fetch fresh server HTML (still an AJAX swap, so
   navigation stays smooth) and re-run the same init path as forward navigation. */
if (window.htmx) window.htmx.config.historyCacheSize = 0

/* Re-init Alpine on htmx-swapped content. afterSettle covers boosted link nav;
   historyRestore covers back/forward (now always a cache-miss server restore).
   initTree skips already-initialised nodes and widgetPreview.init() clears any
   prior timer, so overlapping inits never start a second tick loop. */
function initAlpineTree(e) {
  if (!window.Alpine) return
  const el =
    (e.detail && e.detail.elt) ||
    document.getElementById('content') ||
    document.body
  window.Alpine.initTree(el)
}
document.addEventListener('htmx:afterSettle', initAlpineTree)
document.addEventListener('htmx:historyRestore', initAlpineTree)
/* global Alpine */

// Korean web fonts on jsDelivr (mirrors widget.js FONT_MAP). Pretendard is loaded
// globally via base.html @font-face, so its css is null.
const FONT_MAP = {
  pretendard: { family: 'Pretendard', css: null },
  'gothic-a1': {
    family: 'Gothic A1',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/gothic-a1/index.css',
  },
  'nanum-gothic': {
    family: 'Nanum Gothic',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-gothic/index.css',
  },
  'do-hyeon': {
    family: 'Do Hyeon',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/do-hyeon/index.css',
  },
  'black-han-sans': {
    family: 'Black Han Sans',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/black-han-sans/index.css',
  },
  jua: {
    family: 'Jua',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/jua/index.css',
  },
  'nanum-pen-script': {
    family: 'Nanum Pen Script',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-pen-script/index.css',
  },
  'gamja-flower': {
    family: 'Gamja Flower',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/gamja-flower/index.css',
  },
  'nanum-myeongjo': {
    family: 'Nanum Myeongjo',
    css: 'https://cdn.jsdelivr.net/npm/@fontsource/nanum-myeongjo/index.css',
  },
}
const NICK_PALETTE = [
  '#f1a7b4',
  '#f0c68a',
  '#f2d97e',
  '#a7d99b',
  '#8ed9c4',
  '#8fc9ec',
  '#a3b6ef',
  '#c4abe9',
]
const loadedFonts = new Set()

// Stand-ins for real SSE badge objects (overlay/badges.py build_badge), so each
// carries the same atomic fields the widget concatenates per mode — including the
// pre-resolved `threshold` (the DJ POWER floor for that rank+level, badges.py
// RANK_THRESHOLDS). Threshold mode renders "<button>B <threshold>+", matching widget.js.
// `nickname` mirrors the SSE payload field added in flush.py (feature 4).
const FAKE_CHAT_MESSAGES = [
  { rank: 'SS', level: 'II', power: 9823, threshold: 9800, button: 4, isTheory: false, nickname: '록담', text: '안녕하세요' },
  { rank: 'SS', level: 'I', power: 9888, threshold: 9850, button: 6, isTheory: false, nickname: '디제이펠리스', text: '이거 쉽던데' },
  { rank: 'SD', level: 'IV', power: 5342, threshold: 5200, button: 5, isTheory: false, nickname: '음악천재', text: '처음 왔어요 잘 부탁드려요' },
  { rank: 'PD', level: 'III', power: 7337, threshold: 7200, button: 8, isTheory: false, nickname: '신청곡요정', text: '신청곡 넣어도 되나요?' },
  { rank: 'HL', level: 'II', power: 9600, threshold: 9600, button: 6, isTheory: false, nickname: '망이조아', text: '망이조아' },
  { rank: 'LoD', level: null, power: 10000, threshold: 9980, button: 4, isTheory: true, nickname: '새벽감성', text: 'ㅎㅇ' },
  { rank: 'PRO', level: 'II', power: 8800, threshold: 8800, button: 5, isTheory: false, nickname: '스코어장인', text: '스코어 인증 완료했습니다' },
  { rank: 'AM', level: 'III', power: 2800, threshold: 2800, button: 6, isTheory: false, nickname: '로페바이럴', text: '로페바이럴' },
  { rank: 'MM', level: 'I', power: 6999, threshold: 6800, button: 8, isTheory: false, nickname: '막귀123', text: '잘 좀 해봐요' },
  { rank: 'RK', level: 'II', power: 4600, threshold: 4600, button: 4, isTheory: false, nickname: '키보드워리어', text: '키보드 혹시 뭔가요?' },
  { rank: 'BG', level: null, power: 652, threshold: 0, button: 5, isTheory: false, nickname: '초보왔어요', text: '이거 좀 어렵...' },
  { rank: 'HC', level: 'I', power: 8400, threshold: 8400, button: 6, isTheory: false, nickname: '래더고수', text: '오늘도 래더 하시나요?' },
  { rank: 'BM', level: 'IV', power: 9900, threshold: 9900, button: 8, isTheory: false, nickname: '지린다', text: '지린다 ㄷㄷ' },
  { rank: 'TR', level: 'I', power: 2000, threshold: 2000, button: 4, isTheory: false, nickname: '반가운손님', text: '반가워요' },
  { rank: 'PRO', level: 'I', power: 8900, threshold: 8900, button: 5, isTheory: false, nickname: '연타마스터', text: '연타를 변기에 넣고 내려' },
  { status: 'unverified', nickname: '익명청취자', text: 'ㅁㅁㅁㅁㄷㄴㅅ' },
  { rank: 'SD', level: 'III', power: 5704, threshold: 5500, button: 4, isTheory: false, nickname: '방금그거', text: '방금 어케 친거임' },
  { rank: 'SS', level: 'III', power: 9750, threshold: 9750, button: 8, isTheory: false, nickname: '퍼펙장인', text: '퍼펙 ㅊㅊㅊㅊㅊ' },
  { status: 'unverified', nickname: '탭소닉팬', text: '탭소닉은다시돌아온다' },
  { rank: 'RK', level: 'I', power: 4943, threshold: 4900, button: 6, isTheory: false, nickname: '연타초보', text: '혹시 제가 연타를 잘 못하는데 이거 방법 있을까요? ㅠㅠ' },
]

document.addEventListener('alpine:init', () => {
  Alpine.data('widgetConfig', (base) => ({
    base: base,
    mode: 'short',
    fontSize: 14,
    buttonSel: 'auto',
    fadeoutOn: false,
    fadeoutSec: 15,
    font: 'pretendard',
    textStyle: 'shadow',
    nicknameOn: false,
    dimUnverified: true,
    copied: false,
    fontFamily(key) {
      const f = FONT_MAP[key] || FONT_MAP.pretendard
      return '"' + f.family + '", "Pretendard", system-ui, sans-serif'
    },
    loadFont(key) {
      const f = FONT_MAP[key]
      if (!f || !f.css || loadedFonts.has(key)) return
      loadedFonts.add(key)
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = f.css
      document.head.appendChild(link)
    },
    widgetUrl() {
      if (!this.base) return ''
      const u = new URL(this.base, window.location.origin)
      if (this.mode !== 'short') u.searchParams.set('mode', this.mode)
      if (this.fontSize !== 14)
        u.searchParams.set('fontSize', String(this.fontSize))
      if (this.buttonSel === 'viewer') u.searchParams.set('buttonSel', 'viewer')
      if (this.fadeoutOn) u.searchParams.set('fadeout', String(this.fadeoutSec))
      if (this.font !== 'pretendard') u.searchParams.set('font', this.font)
      if (this.textStyle !== 'shadow')
        u.searchParams.set('textStyle', this.textStyle)
      if (this.nicknameOn) u.searchParams.set('nickname', 'on')
      if (!this.dimUnverified) u.searchParams.set('dimUnverified', 'off')
      return u.toString()
    },
    copy() {
      const url = this.widgetUrl()
      if (!url) return
      navigator.clipboard.writeText(url)
      this.copied = true
      setTimeout(() => {
        this.copied = false
      }, 2000)
    },
  }))

  Alpine.data('widgetPreview', () => ({
    rows: [],
    timer: null,
    i: 0,
    nickIdx: 0,
    init() {
      // Idempotent: clear any prior tick loop so overlapping inits (htmx swap +
      // Alpine's own observer) never leave two timers pushing rows at once.
      if (this.timer) clearTimeout(this.timer)
      this.rows = []
      this.i = 0
      this.nickIdx = 0
      this.tick()
    },
    tick() {
      const base = FAKE_CHAT_MESSAGES[this.i % FAKE_CHAT_MESSAGES.length]
      // Assign the rainbow color once at push time so it stays stable across
      // re-renders (feature 4: arrival-order cycle, not per-nickname).
      this.rows.push(
        Object.assign({}, base, {
          _nickColor: NICK_PALETTE[this.nickIdx++ % NICK_PALETTE.length],
        })
      )
      this.i++
      if (this.rows.length > 15) this.rows.shift()
      this.$nextTick(() => {
        const el = this.$refs.preview
        if (el) el.scrollTop = el.scrollHeight
      })
      this.timer = setTimeout(
        () => this.tick(),
        500 + Math.floor(Math.random() * 700)
      )
    },
    destroy() {
      if (this.timer) clearTimeout(this.timer)
    },
    badgeText(m, mode) {
      const prefix = m.button + 'B'
      if (mode === 'power')
        return prefix + ' ' + (m.power == null ? 0 : m.power)
      if (mode === 'threshold') {
        if (m.isTheory) return prefix + ' 10000'
        if (m.threshold != null) return prefix + ' ' + m.threshold + '+'
        return prefix + ' ' + m.rank
      }
      return prefix + ' ' + m.rank + (m.level ? ' ' + m.level : '')
    },
  }))
})
