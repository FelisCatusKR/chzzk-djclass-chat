/* Dashboard live preview: cycle fake DJ CLASS chat messages. Port of
   src/components/WidgetPreview.tsx + src/lib/fake-chat-messages.ts. Badge colors
   come from badge.css (.dj-badge.rank-*); text from the same rules as widget.js. */
window.FAKE_CHAT_MESSAGES = [
  {
    rank: 'SS',
    level: 'II',
    power: 9823,
    button: 4,
    isTheory: false,
    text: '안녕하세요',
  },
  {
    rank: 'SS',
    level: 'I',
    power: 9888,
    button: 6,
    isTheory: false,
    text: '이거 쉽던데',
  },
  {
    rank: 'SD',
    level: 'IV',
    power: 5342,
    button: 5,
    isTheory: false,
    text: '처음 왔어요 잘 부탁드려요',
  },
  {
    rank: 'PD',
    level: 'III',
    power: 7337,
    button: 8,
    isTheory: false,
    text: '신청곡 넣어도 되나요?',
  },
  {
    rank: 'HL',
    level: 'II',
    power: 9600,
    button: 6,
    isTheory: false,
    text: '망이조아',
  },
  {
    rank: 'LoD',
    level: null,
    power: 10000,
    button: 4,
    isTheory: true,
    text: 'ㅎㅇ',
  },
  {
    rank: 'PRO',
    level: 'II',
    power: 8800,
    button: 5,
    isTheory: false,
    text: '스코어 인증 완료했습니다',
  },
  {
    rank: 'AM',
    level: 'III',
    power: 2800,
    button: 6,
    isTheory: false,
    text: '로페바이럴',
  },
  {
    rank: 'MM',
    level: 'I',
    power: 6999,
    button: 8,
    isTheory: false,
    text: '잘 좀 해봐요',
  },
  {
    rank: 'RK',
    level: 'II',
    power: 4600,
    button: 4,
    isTheory: false,
    text: '키보드 혹시 뭔가요?',
  },
  {
    rank: 'BG',
    level: null,
    power: 652,
    button: 5,
    isTheory: false,
    text: '이거 좀 어렵...',
  },
  {
    rank: 'HC',
    level: 'I',
    power: 8400,
    button: 6,
    isTheory: false,
    text: '오늘도 래더 하시나요?',
  },
  {
    rank: 'BM',
    level: 'IV',
    power: 9900,
    button: 8,
    isTheory: false,
    text: '지린다 ㄷㄷ',
  },
  {
    rank: 'TR',
    level: 'I',
    power: 2000,
    button: 4,
    isTheory: false,
    text: '반가워요',
  },
  {
    rank: 'PRO',
    level: 'I',
    power: 8900,
    button: 5,
    isTheory: false,
    text: '연타를 변기에 넣고 내려',
  },
  { status: 'unverified', text: 'ㅁㅁㅁㅁㄷㄴㅅ' },
  {
    rank: 'SD',
    level: 'III',
    power: 5704,
    button: 4,
    isTheory: false,
    text: '방금 어케 친거임',
  },
  {
    rank: 'SS',
    level: 'III',
    power: 9750,
    button: 8,
    isTheory: false,
    text: '퍼펙 ㅊㅊㅊㅊㅊ',
  },
  { status: 'unverified', text: '탭소닉은다시돌아온다' },
  {
    rank: 'RK',
    level: 'I',
    power: 4943,
    button: 6,
    isTheory: false,
    text: '혹시 제가 연타를 잘 못하는데 이거 방법 있을까요? ㅠㅠ',
  },
]

window.widgetPreview = function () {
  return {
    rows: [],
    timer: null,
    i: 0,
    init() {
      this.tick()
    },
    tick() {
      var msgs = window.FAKE_CHAT_MESSAGES
      this.rows.push(msgs[this.i % msgs.length])
      this.i++
      if (this.rows.length > 15) this.rows.shift()
      this.$nextTick(() => {
        var el = this.$refs.preview
        if (el) el.scrollTop = el.scrollHeight
      })
      var delay = 500 + Math.floor(Math.random() * 700) // 500–1200ms
      this.timer = setTimeout(() => this.tick(), delay)
    },
    destroy() {
      if (this.timer) clearTimeout(this.timer)
    },
    badgeText(m) {
      var prefix = m.button + 'B'
      if (this.mode === 'power')
        return prefix + ' ' + (m.power == null ? 0 : m.power)
      if (this.mode === 'threshold') {
        if (m.isTheory) return prefix + ' 10000'
        return prefix + ' ' + m.rank + (m.level ? ' ' + m.level : '')
      }
      return prefix + ' ' + m.rank + (m.level ? ' ' + m.level : '')
    },
  }
}
