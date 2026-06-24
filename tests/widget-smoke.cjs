#!/usr/bin/env node
/*
 * Dependency-free smoke test for the no-build browser scripts served by WhiteNoise
 * (the OBS overlay widget + the htmx/Alpine page glue). It loads the REAL files with
 * stubbed DOM/browser globals and asserts they initialize — and that the overlay
 * renders an SSE batch — without throwing.
 *
 * Why this exists: these files have no other automated coverage (CI is Python-only;
 * `node --check` validates SYNTAX only). A load-time init-order crash in widget.js
 * (`var FONT = parseFont(...)` ran before `var FONT_MAP` was assigned → threw, aborting
 * the whole IIFE → no chat rendered at all) shipped in PR #17 and was hotfixed in #18.
 * This test executes the code, so that class of bug fails CI instead of production.
 *
 * Run: node tests/widget-smoke.cjs   (exit 0 = ok, 1 = failure)
 */
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const WIDGET = path.join(ROOT, 'djclass_overlay/overlay/static/overlay/widget.js')
const COMPONENTS = path.join(ROOT, 'djclass_overlay/static/js/components.js')

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log('  ok   ' + name)
  } catch (e) {
    failures++
    console.log('  FAIL ' + name + ' — ' + e.name + ': ' + e.message)
  }
}

// --- minimal DOM/browser stubs ---------------------------------------------
function makeEl() {
  return {
    style: {
      setProperty() {},
    },
    dataset: { channelId: 'smoke' },
    className: '',
    textContent: '',
    loading: '',
    src: '',
    alt: '',
    rel: '',
    href: '',
    _children: [],
    classList: { add() {}, remove() {}, contains() { return false } },
    appendChild(c) { this._children.push(c); return c },
    removeChild() {},
    remove() {},
    get childElementCount() { return this._children.length },
    get firstChild() { return this._children[0] || null },
    get children() { return this._children.slice() },
    scrollTop: 0,
    scrollHeight: 0,
  }
}

// Evaluate `code` with `globalsObj` keys visible as bare identifiers, mirroring how
// the browser exposes window/document/etc. Real built-ins (Object, JSON, Date, Math,
// URLSearchParams) resolve normally inside the generated function.
function runInScope(code, globalsObj) {
  const names = Object.keys(globalsObj)
  const values = names.map((n) => globalsObj[n])
  const fn = new Function(...names, code)
  fn(...values)
}

function loadWidget(search) {
  const code = fs.readFileSync(WIDGET, 'utf8')
  let chatHandler = null
  runInScope(code, {
    document: {
      getElementById: () => makeEl(),
      createElement: () => makeEl(),
      createTextNode: () => ({}),
      head: { appendChild() {} },
    },
    location: { search },
    URLSearchParams,
    EventSource: function () {
      return {
        addEventListener(type, fn) {
          if (type === 'chat') chatHandler = fn
        },
        onopen: null,
        onerror: null,
      }
    },
  })
  return { chatHandler }
}

function loadComponents() {
  const code = fs.readFileSync(COMPONENTS, 'utf8')
  const listeners = {}
  runInScope(code, {
    window: {},
    document: {
      addEventListener(type, fn) {
        listeners[type] = fn
      },
    },
  })
  return { listeners }
}

// A realistic SSE batch exercising the render paths: linked badge, theory glint,
// unverified row, emoji substitution, and nicknames.
const FAKE_BATCH = {
  messages: [
    {
      id: 1,
      text: '안녕 {:emo1:}',
      emojis: { emo1: 'https://example/e.png' },
      status: 'linked',
      nickname: '록담',
      badge: {
        auto: { rank: 'SS', button: 4, class: 'SS II', threshold: 9800, power: 9823, isTheory: false },
        viewer: { rank: 'SS', button: 4, class: 'SS II', threshold: 9800, power: 9823, isTheory: false },
      },
    },
    {
      id: 2,
      text: 'theory',
      emojis: {},
      status: 'linked',
      nickname: '새벽',
      badge: {
        auto: { rank: 'LoD', button: 4, class: 'LoD', threshold: 9980, power: 10000, isTheory: true },
        viewer: { rank: 'LoD', button: 4, class: 'LoD', threshold: 9980, power: 10000, isTheory: true },
      },
    },
    { id: 3, text: 'hi there', emojis: {}, status: 'unlinked', nickname: '김토니', badge: null },
  ],
}

// --- run --------------------------------------------------------------------
console.log('widget.js — load + render across param combos:')
const COMBOS = [
  '',
  '?font=do-hyeon',
  '?nickname=on&textStyle=outline&dimUnverified=off',
  '?font=bogus&mode=power',
  '?nickname=on&mode=threshold',
]
for (const search of COMBOS) {
  check('load+render [' + (search || '(none)') + ']', () => {
    const { chatHandler } = loadWidget(search)
    if (typeof chatHandler !== 'function') throw new Error("'chat' listener not registered")
    chatHandler({ data: JSON.stringify(FAKE_BATCH) })
  })
}

console.log('components.js — load:')
check('load (registers alpine:init)', () => {
  const { listeners } = loadComponents()
  if (typeof listeners['alpine:init'] !== 'function') throw new Error('alpine:init not registered')
})

if (failures) {
  console.log('\nSMOKE FAILED: ' + failures + ' failure(s)')
  process.exit(1)
}
console.log('\nSMOKE OK')
