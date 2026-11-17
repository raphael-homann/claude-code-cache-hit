import { expect, test } from 'claude-code/testing'

import { absorb, pct, stats, tone } from './calc'
import type { FileScan } from './calc'

const fresh = (): FileScan => ({ from: 0, calls: new Map() })

test('une réponse écrite en plusieurs lignes ne compte qu’une fois', async () => {
  const out = ['5', '["m1",2,0,10000]', '["m1",2,0,10000]', '["m2",2,9000,1000]', '["m2",2,9000,1000]'].join('\n')
  const scan = absorb(fresh(), out)
  expect(scan.from).toBe(5)
  expect(scan.calls.size).toBe(2)
  const s = stats(scan, [])
  expect(s.ownCount).toBe(2)
  expect(s.own).toEqual({ read: 9000, total: 20004 })
  expect(pct(s.own)).toBe(45)
})

test('la lecture par morceaux donne la même chose qu’une lecture complète', async () => {
  const once = absorb(fresh(), '3\n["a",1,100,0]\n["b",1,200,0]\n["c",1,300,0]')
  const first = absorb(fresh(), '2\n["a",1,100,0]\n["b",1,200,0]')
  const both = absorb(first, '3\n["c",1,300,0]')
  expect([...both.calls.entries()]).toEqual([...once.calls.entries()])
  // Fichier raccourci (scan.sh repart de 0) : on oublie l’ancien contenu.
  const reset = absorb(both, '1\n["z",1,50,0]')
  expect([...reset.calls.keys()]).toEqual(['z'])
})

test('couleurs : cache perdu, moyen, bon', async () => {
  expect(tone({ read: 0, total: 20000 })).toBe('error')
  expect(tone({ read: 6000, total: 10000 })).toBe('warning')
  expect(tone({ read: 9500, total: 10000 })).toBe('success')
  // Petit appel sans cache (titre…) : sous le seuil, pas « perdu », mais < 50 % reste rouge.
  expect(tone({ read: 0, total: 100 })).toBe('error')
})

test('les sous-agents sans appel ne comptent pas', async () => {
  const main = absorb(fresh(), '1\n["a",0,90,10]')
  const sub1 = absorb(fresh(), '2\n["s1",0,50,50]\n["s2",0,100,0]')
  const s = stats(main, [sub1, fresh()])
  expect(s.subCount).toBe(1)
  expect(s.subs).toEqual({ read: 150, total: 200 })
})

const PANE = {
  plugin: 'cache-hit',
  component: 'Pane',
  requestId: 'cache-hit',
  props: {
    title: 'Cache réutilisé',
    isFocused: true,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'cache-hit',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const SEEDED = {
  own: { read: 740, total: 1000 },
  ownCount: 3,
  recent: [
    { read: 0, total: 20000 },
    { read: 6000, total: 10000 },
    { read: 900, total: 1000 },
  ],
  subs: { read: 940, total: 1000 },
  subCount: 2,
  subRecent: [
    { read: 400, total: 1000 },
    { read: 990, total: 1000 },
  ],
}

const seed = (on: any, value: unknown) =>
  on('state.get', () => ({ value: { value: { shape: 'stats-2', value }, version: 1 } }))

test('la popup : barre puis points sous chaque session', async ($, on) => {
  seed(on, SEEDED)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Session principale \(3\)/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^ +74%$/ }))?.text).toBe(' 74%')
    expect((await ui.find({ type: 'Text', text: /^Sous-agents \(2\)/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^ +94%$/ }))?.text).toBe(' 94%')
    expect(await ui.find({ type: 'Text', text: /tokens relus · \d+ appels/ })).toBeFalsy()
    const dots = await ui.findAll({ type: 'Text', text: '●' })
    // 3 points de la session principale, 2 des sous-agents, 3 de la légende
    expect(dots.map((d: any) => d.props?.color ?? d.color)).toEqual([
      'error', 'warning', 'success',
      'error', 'success',
      'success', 'warning', 'error',
    ])
    expect((await ui.find({ type: 'Text', text: /^Total 84%/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'Fermer' })).toBeTruthy()
    await ui.unmount()
  }
})

test('les appels des sous-agents sont remis dans l’ordre chronologique', async () => {
  const a = absorb(fresh(), '2\n["a1",0,10,0,"2026-11-17T10:00:00Z"]\n["a2",0,30,0,"2026-11-17T10:00:02Z"]')
  const b = absorb(fresh(), '1\n["b1",0,20,0,"2026-11-17T10:00:01Z"]')
  const s = stats(undefined, [a, b])
  expect(s.subRecent.map(c => c.read)).toEqual([10, 20, 30])
})

test('sans réponse, la popup attend', async ($, on) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /première réponse/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('un clic sur la ligne ouvre la popup, un second la referme', async ($, on) => {
  // Le clic relance aussi la lecture des transcripts : ici, sans transcript.
  on('clock.sleep', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'test' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  let isOpen = false
  const calls: string[] = []
  on('ui.open', (_: unknown, e: any) => {
    calls.push(`open focus=${e.focus} esc=${e.closeOnEscape}`)
    isOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls.push('close')
    isOpen = false
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'cache-hit', title: 'Cache réutilisé', isPlaced: true, isShown: true, isFocused: true }] : [] }))

  seed(on, SEEDED)
  for (const surface of ['terminal', 'desktop'] as const) {
    calls.length = 0
    isOpen = false
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: '84%' }))?.text).toBe('84%')
    expect((await ui.find({ type: 'Text', text: ' · détails' }))?.text).toBeTruthy()
    await ui.press({ key: 'cache-hit' })
    expect(calls).toEqual(['open focus=true esc=true'])
    await ui.press({ key: 'cache-hit' })
    expect(calls).toEqual(['open focus=true esc=true', 'close'])
    await ui.unmount()
  }
})
