/* Functional DJ CLASS overlay widget (vanilla JS, no build).
   Consumes the SSE batch stream; assembles badge text per mode from the atomic
   fields the server pre-resolved. Visual polish (gradient colors, theory glint,
   opacity tiers, daisyUI) is deferred to Plan 6. Parity helpers ported from
   src/lib/{font-size,fadeout,emoji}.ts and the badge-text rules in dj-class.ts. */
;(function () {
  'use strict'

  var params = new URLSearchParams(location.search)
  var MODE =
    ['short', 'threshold', 'power'].indexOf(params.get('mode')) >= 0
      ? params.get('mode')
      : 'short'
  var BUTTON_SEL = params.get('buttonSel') === 'viewer' ? 'viewer' : 'auto'
  var FONT_SIZE = parseFontSize(params.get('fontSize'))
  var FADEOUT_SEC = parseFadeout(params.get('fadeout'))

  var chat = document.getElementById('chat')
  var statusEl = document.getElementById('status')
  chat.style.fontSize = FONT_SIZE + 'px'

  function parseFontSize(raw) {
    // font-size.ts: 12–28, default 14
    if (!raw) return 14
    var n = Number(raw)
    if (!isFinite(n)) return 14
    return Math.min(28, Math.max(12, Math.round(n)))
  }
  function parseFadeout(raw) {
    // fadeout.ts: 5–60, 0<x<5 ⇒ off, none ⇒ off
    if (!raw) return 0
    var n = Number(raw)
    if (!isFinite(n)) return 0
    var r = Math.round(n)
    if (r < 5) return 0
    return Math.min(60, r)
  }

  function badgeText(badge) {
    // dj-class.ts getBadgeText, atomic fields
    var prefix = badge.button + 'B'
    if (MODE === 'power')
      return prefix + ' ' + (badge.power == null ? 0 : badge.power)
    if (MODE === 'threshold') {
      if (badge.isTheory) return prefix + ' 10000'
      if (badge.threshold != null) return prefix + ' ' + badge.threshold + '+'
      return prefix + ' ' + badge.rank
    }
    return prefix + ' ' + badge['class'] // short
  }

  var EMOJI_RE = /\{:([\w-]+):\}/g // emoji.ts parseEmojiContent
  function appendContent(parent, content, emojis) {
    var last = 0,
      m
    EMOJI_RE.lastIndex = 0
    while ((m = EMOJI_RE.exec(content)) !== null) {
      if (m.index > last)
        parent.appendChild(
          document.createTextNode(content.slice(last, m.index))
        )
      var url = emojis && emojis[m[1]]
      if (url) {
        var img = document.createElement('img')
        img.src = url
        img.alt = ''
        img.className = 'emoji'
        img.loading = 'lazy'
        parent.appendChild(img)
      } // unmatched key dropped
      last = m.index + m[0].length
    }
    if (last < content.length)
      parent.appendChild(document.createTextNode(content.slice(last)))
  }

  var GLINT_PERIOD_MS = 2600 // dj-class.ts GLINT_PERIOD_MS
  function glintDelayMs(now) {
    var offset = now % GLINT_PERIOD_MS
    return offset === 0 ? 0 : -offset
  }

  function addMessage(msg) {
    var row = document.createElement('div')
    row.className = 'row'
    row.dataset.created = String(Date.now())

    if (msg.status === 'linked' && msg.badge) {
      var badge = msg.badge[BUTTON_SEL]
      var b = document.createElement('span')
      b.className =
        'dj-badge rank-' + badge.rank + (badge.isTheory ? ' shiny' : '')
      if (badge.isTheory) {
        b.style.setProperty('--glint-duration', GLINT_PERIOD_MS + 'ms')
        b.style.setProperty('--glint-delay', glintDelayMs(Date.now()) + 'ms')
      }
      b.textContent = badgeText(badge)
      row.appendChild(b)
    } else if (msg.status === 'unlinked' || msg.status === 'unsynced') {
      row.classList.add('unverified-row')
      var u = document.createElement('span')
      u.className = 'dj-badge unverified'
      u.textContent = '미인증'
      row.appendChild(u)
    }

    var text = document.createElement('span')
    appendContent(text, msg.text, msg.emojis)
    row.appendChild(text)

    chat.appendChild(row)
    while (chat.childElementCount > 100) chat.removeChild(chat.firstChild) // cap 100
    chat.scrollTop = chat.scrollHeight // pin bottom
  }

  if (FADEOUT_SEC > 0) {
    // two-phase fade: flag, then remove (+500ms)
    setInterval(function () {
      var now = Date.now()
      Array.prototype.slice.call(chat.children).forEach(function (row) {
        var age = now - Number(row.dataset.created || now)
        if (age >= FADEOUT_SEC * 1000 + 500) row.remove()
        else if (age >= FADEOUT_SEC * 1000) row.classList.add('fading')
      })
    }, 250)
  }

  var es = new EventSource('/widget/' + window.CHANNEL_ID + '/stream')
  es.onopen = function () {
    statusEl.textContent = ''
  }
  es.onerror = function () {
    statusEl.textContent = '채팅 연결 실패 (재연결 중…)'
  }
  es.addEventListener('chat', function (e) {
    var batch = JSON.parse(e.data)
    ;(batch.messages || []).forEach(addMessage)
  })
})()
