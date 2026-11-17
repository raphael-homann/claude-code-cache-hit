import { expect, test } from 'claude-code/testing'

import { absorb, pct, stats, tone } from './calc'
import { langFromLocale } from './i18n'
import type { FileScan } from './calc'

const fresh = (): FileScan => ({ from: 0, calls: new Map() })

test('a response written over several lines counts once', async () => {
  const out = ['5', '["m1",2,0,10000]', '["m1",2,0,10000]', '["m2",2,9000,1000]', '["m2",2,9000,1000]'].join('\n')
  const scan = absorb(fresh(), out)
  expect(scan.from).toBe(5)
  expect(scan.calls.size).toBe(2)
  const s = stats(scan, [])
  expect(s.ownCount).toBe(2)
  expect(s.own).toEqual({ read: 9000, total: 20004 })
  expect(pct(s.own)).toBe(45)
})

test('an incremental read gives the same as a full one', async () => {
  const once = absorb(fresh(), '3\n["a",1,100,0]\n["b",1,200,0]\n["c",1,300,0]')
  const first = absorb(fresh(), '2\n["a",1,100,0]\n["b",1,200,0]')
  const both = absorb(first, '3\n["c",1,300,0]')
  expect([...both.calls.entries()]).toEqual([...once.calls.entries()])
  // Shortened file (scan.sh restarts from 0): the old content is dropped.
  const reset = absorb(both, '1\n["z",1,50,0]')
  expect([...reset.calls.keys()]).toEqual(['z'])
})

test('colors: lost, medium, good', async () => {
  expect(tone({ read: 0, total: 20000 })).toBe('error')
  expect(tone({ read: 6000, total: 10000 })).toBe('warning')
  expect(tone({ read: 9500, total: 10000 })).toBe('success')
  // Small request without cache (a title…): under the threshold, not « lost », but < 50 % stays red.
  expect(tone({ read: 0, total: 100 })).toBe('error')
})

test('subagents without requests do not count', async () => {
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
    title: 'Cache hits',
    isFocused: true,
    bodyColumns: 44,
    placement: 'inline',
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

/** Seeds the stats alone: the other values (language, popup) keep the kit's own state. */
const seed = (on: any, value: unknown) =>
  on('state.get', { plugin: 'cache-hit', key: 'stats' }, () => ({
    value: { value: { shape: 'stats-2', value }, version: 1 },
  }))

/** The refresh a click starts finds no transcript here. */
const noTranscript = (on: any) => {
  on('clock.sleep', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'test' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
}

test('subagent requests are put back in chronological order', async () => {
  const a = absorb(fresh(), '2\n["a1",0,10,0,"2026-11-17T10:00:00Z"]\n["a2",0,30,0,"2026-11-17T10:00:02Z"]')
  const b = absorb(fresh(), '1\n["b1",0,20,0,"2026-11-17T10:00:01Z"]')
  const s = stats(undefined, [a, b])
  expect(s.subRecent.map(c => c.read)).toEqual([10, 20, 30])
})

test('the language follows the locale, French or else English', async () => {
  expect(langFromLocale('fr_FR.UTF-8')).toBe('fr')
  expect(langFromLocale('en_US.UTF-8')).toBe('en')
  expect(langFromLocale('de_DE.UTF-8')).toBe('en')
  expect(langFromLocale(undefined)).toBe('en')
})

test('the popup: a bar then dots under each session', async ($, on) => {
  seed(on, SEEDED)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Main session \(3\)/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^ +74%$/ }))?.text).toBe(' 74%')
    expect((await ui.find({ type: 'Text', text: /^Subagents \(2\)/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /^ +94%$/ }))?.text).toBe(' 94%')
    const dots = await ui.findAll({ type: 'Text', text: '●' })
    // 3 dots for the main session, 2 for the subagents, 3 in the legend
    expect(dots.map((d: any) => d.props?.color ?? d.color)).toEqual([
      'error', 'warning', 'success',
      'error', 'success',
      'success', 'warning', 'error',
    ])
    expect((await ui.find({ type: 'Text', text: /^Total 84%/ }))?.text).toBeTruthy()
    expect(await ui.find({ type: 'Button', key: 'Close' })).toBeTruthy()
    await ui.unmount()
  }
})

test('the docked pane is asked as wide as the inline content, and fits a narrower dock', async ($, on) => {
  seed(on, SEEDED)
  const asked: number[] = []
  on('ui.open', (_: unknown, e: any) => {
    asked.push(e.columns)
    return { value: { isPlaced: true } }
  })
  for (const lang of ['en', 'fr'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, placement: 'dock', bodyColumns: 24 } })
    if (lang === 'fr') await ui.press({ key: 'lang' })
    const texts: string[] = (await ui.findAll({ type: 'Text' })).map((x: any) => x.text)
    // Each row is at most 24 cells: the bars, the dots, the labels, the legend and the total.
    const rows = [
      ...texts.filter(x => x.length > 1 && !/^[━─●]+$/.test(x)),
    ]
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(24)
    expect(texts.some(x => /^Total 84% · 2k\/2k$/.test(x))).toBe(true)
    expect(texts.some(x => x === ' <50%')).toBe(true)
    await ui.unmount()
    if (lang === 'fr') expect(asked).toEqual([40])
  }
})

test('`l` switches the popup between English and French, and keeps the choice', async ($, on) => {
  seed(on, SEEDED)
  const titles: string[] = []
  on('ui.open', (_: unknown, e: any) => {
    titles.push(e.title)
    return { value: { isPlaced: true } }
  })
  const store = new Map<string, unknown>()
  on('store.set', (_: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /^Main session/ }))?.text).toBeTruthy()
  await ui.press({ key: 'lang' })
  expect((await ui.find({ type: 'Text', text: /^Session principale \(3\)/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^Sous-agents \(2\)/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /cache perdu/ }))?.text).toBeTruthy()
  expect(store.get('lang')).toBe('fr')
  expect(titles).toEqual(['Cache réutilisé'])
  await ui.press({ key: 'lang' })
  expect((await ui.find({ type: 'Text', text: /^Main session/ }))?.text).toBeTruthy()
  expect(store.get('lang')).toBe('en')
  await ui.unmount()
})

test('with no response yet, the popup waits', async ($, on) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /first response/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('a click on the line opens the popup, a second one closes it', async ($, on) => {
  noTranscript(on)
  seed(on, SEEDED)
  const calls: string[] = []
  on('ui.open', (_: unknown, e: any) => {
    calls.push(`open focus=${e.focus} esc=${e.closeOnEscape}`)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls.push('close')
    return { value: undefined }
  })
  // Nothing may be awaited before the open: a click must never list the panes first.
  on('ui.panes', () => {
    calls.push('panes')
    return { value: [] }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    calls.length = 0
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: '84%' }))?.text).toBe('84%')
    expect((await ui.find({ type: 'Text', text: ' · details' }))?.text).toBeTruthy()
    await ui.press({ key: 'cache-hit' })
    expect(calls).toEqual(['open focus=true esc=true'])
    expect((await ui.find({ type: 'Text', text: ' · hide' }))?.text).toBeTruthy()
    await ui.press({ key: 'cache-hit' })
    expect(calls).toEqual(['open focus=true esc=true', 'close'])
    expect((await ui.find({ type: 'Text', text: ' · details' }))?.text).toBeTruthy()
    await ui.unmount()
  }
})

/** Lets the refresh a hook started without awaiting run to its end. */
const settle = async () => {
  // setTimeout exists in the hooks environment, but its typings leave it out.
  const later = (globalThis as unknown as { setTimeout: (run: () => void, ms: number) => unknown }).setTimeout
  for (let i = 0; i < 50; i++) await new Promise<void>(resolve => later(resolve, 0))
}

test('a refresh reads only the transcripts whose size changed', async ($, on) => {
  const dir = '/home/u/.claude/projects/-work'
  const sizes: Record<string, number> = {
    [`${dir}/s1.jsonl`]: 100,
    [`${dir}/s1/subagents/agent-a.jsonl`]: 50,
    [`${dir}/s1/subagents/agent-b.jsonl`]: 60,
  }
  const out: Record<string, string> = {
    [`${dir}/s1.jsonl`]: '1\n["m1",0,90,10,"2026-11-17T10:00:00Z"]',
    [`${dir}/s1/subagents/agent-a.jsonl`]: '1\n["a1",0,50,50,"2026-11-17T10:00:01Z"]',
    [`${dir}/s1/subagents/agent-b.jsonl`]: '1\n["b1",0,0,100,"2026-11-17T10:00:02Z"]',
  }
  const scanned: string[] = []
  let now = 0
  on('clock.sleep', () => ({ value: undefined }))
  on('clock.now', () => ({ value: (now += 5000) }))
  on('session.id', () => ({ value: 's1' }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.exists', (_: unknown, e: any) => ({ value: e.path in sizes }))
  on('fs.stat', (_: unknown, e: any) => ({ value: { kind: 'file' as const, size: sizes[e.path] ?? 0, mtimeMs: 0, isLink: false } }))
  on('fs.list', (_: unknown, e: any) => ({
    value: e.path === `${dir}/s1/subagents`
      ? ['agent-a.jsonl', 'agent-a.meta.json', 'agent-b.jsonl'].map(name => ({
          name, kind: 'file', size: sizes[`${e.path}/${name}`] ?? 10, mtimeMs: 0, isLink: false,
        }))
      : [],
  }))
  on('process.run', (_: unknown, e: any) => {
    const path = e.argv[2]
    scanned.push(path.replace(`${dir}/`, ''))
    const text = out[path] ?? '0'
    out[path] = text.split('\n')[0] ?? '0' // the next read of an unchanged file adds nothing
    return { value: { exitCode: 0, stdout: text, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await settle()
  expect(scanned.sort()).toEqual(['s1.jsonl', 's1/subagents/agent-a.jsonl', 's1/subagents/agent-b.jsonl'])

  // Only the main transcript grows.
  scanned.length = 0
  sizes[`${dir}/s1.jsonl`] = 200
  out[`${dir}/s1.jsonl`] = '2\n["m2",0,100,0,"2026-11-17T10:00:03Z"]'
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await settle()
  expect(scanned).toEqual(['s1.jsonl'])
})
