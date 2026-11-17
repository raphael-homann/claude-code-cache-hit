// Shows how much of each request's input is read back from the prompt cache, for the
// open session: a clickable line above the prompt (« cache 93% ●●●● ») that opens a popup.
// Source: the session's JSONL transcripts (main + subagents/agent-*.jsonl), read
// incrementally by hooks/scan.sh (jq) so that 100 MB+ transcripts stay cheap.
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Api, Register } from 'claude-code'

import type { Call, Stats } from '../types'
import { absorb, EMPTY, GOOD, k, MID, overall, pct, projectDirName, stats, tone } from './calc'
import type { FileScan } from './calc'
import { isLang, langFromLocale, otherLang, problemText, TEXTS } from './i18n'
import type { Lang } from './i18n'

const PANE = 'cache-hit'
const MIN_INTERVAL_MS = 1000
/** Dots shown in the line above the prompt. */
const BAND_DOTS = 12
/** Maximum width of the popup bars. */
const BAR_MAX = 40
/** Width asked for the pane when docked beside the transcript: as wide as the inline block's content. */
const DOCK_COLUMNS = BAR_MAX

const statsAtom = atom({ plugin: 'cache-hit', key: 'stats' } as const, EMPTY, { shape: 'stats-2' })
/** Whether the popup is open and drawn: the band then says « hide » instead of « details ». */
const popupOpen = atom({ plugin: 'cache-hit', key: 'popupOpen' } as const, false, { shape: 'open-1' })
/** Interface language, also kept in $.store across sessions. */
const langAtom = atom({ plugin: 'cache-hit', key: 'lang' } as const, 'en' as Lang, { shape: 'lang-1' })

// Module state, reset on each reload of the module: everything is read again then.
let sessionId: string | undefined
let mainPath: string | undefined
let mainScan: FileScan | undefined
const subScans = new Map<string, FileScan>()
let running: Promise<void> | undefined
let dirty = false
let lastRun = 0

const fresh = (): FileScan => ({ from: 0, calls: new Map() })

async function projectsDir($: Api) {
  const config = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  return `${(config || `${home}/.claude`).replace(/[\\/]$/, '')}/projects`
}

/** The session's transcript: first where Claude Code keeps it, else searched for. */
async function findTranscript($: Api, id: string) {
  const projects = await projectsDir($)
  const dirs = [await $.session.root(), await $.session.cwd()]
  for (const dir of dirs) {
    const path = `${projects}/${projectDirName(dir)}/${id}.jsonl`
    if (await $.fs.exists(path)) return path
  }
  for (const entry of await $.fs.list(projects).catch(() => [])) {
    if (entry.kind !== 'dir') continue
    const path = `${projects}/${entry.name}/${id}.jsonl`
    if (await $.fs.exists(path)) return path
  }
  return undefined
}

/**
 * Reads what was added to a transcript since `scan`. `size` is the file's size now
 * (from `$.fs.list` or `$.fs.stat`): unchanged, the file is not read and no process runs.
 */
async function scanFile($: Api, path: string, scan: FileScan, size: number): Promise<FileScan> {
  if (scan.size === size) return scan
  const { exitCode, stdout, stderr } = await $.process.run(
    ['sh', `${$.plugin.root}/hooks/scan.sh`, path, String(scan.from)],
    { timeoutMs: 60_000 },
  )
  if (exitCode !== 0) throw new Error(stderr.trim() || `scan.sh: code ${exitCode}`)
  // The size read before the scan: a file that grew meanwhile is read again next time.
  return { ...absorb(scan, stdout), size }
}

async function refreshOnce($: Api) {
  const id = await $.session.id()
  if (id !== sessionId) {
    // New session (start, /clear, resume): start over.
    sessionId = id
    mainPath = undefined
    mainScan = undefined
    subScans.clear()
  }
  mainPath ??= await findTranscript($, id)
  if (!mainPath) {
    await publish($, { ...EMPTY, problem: 'transcript' })
    return
  }

  const { size: mainSize } = await $.fs.stat(mainPath)
  mainScan = await scanFile($, mainPath, mainScan ?? fresh(), mainSize)

  const subDir = `${mainPath.replace(/\.jsonl$/, '')}/subagents`
  const entries = await $.fs.list(subDir).catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/^agent-.*\.jsonl$/.test(entry.name)) continue
    const path = `${subDir}/${entry.name}`
    subScans.set(path, await scanFile($, path, subScans.get(path) ?? fresh(), entry.size))
  }

  await publish($, stats(mainScan, [...subScans.values()]))
}

async function publish($: Api, next: Stats) {
  await update($, statsAtom, () => next)
  // v0.1 wrote « cache N% » in the status line, which outlives a reload:
  // the clickable line above the prompt replaces it.
  $.ui.status(undefined)
}

/** The language: the one chosen with `l`, else the locale's. */
async function initialLang($: Api): Promise<Lang> {
  const stored = await $.store.get('lang').catch(() => undefined)
  if (isLang(stored)) return stored
  const locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
  return langFromLocale(locale)
}

/**
 * The popup: a pane that takes the keyboard and closes on Escape. Nothing is awaited
 * before `$.ui.open`, so that an open from a click counts as the person's: it is then
 * drawn at any terminal width (an unasked one waits undrawn below 144 columns).
 */
async function openPopup($: Api, lang: Lang) {
  const opened = $.ui.open({
    id: PANE,
    title: TEXTS[lang].title,
    focus: true,
    closeOnEscape: true,
    columns: DOCK_COLUMNS,
  })
  void refresh($)
  const { isPlaced } = await opened
  await update($, popupOpen, () => isPlaced)
  return isPlaced
}

async function closePopup($: Api) {
  await $.ui.close({ id: PANE })
  await update($, popupOpen, () => false)
}

/** Whether the popup is really on screen: listed, drawn and the pane shown. */
async function isPopupShown($: Api) {
  return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
}

/** Reads the transcripts again; requests made during a read are coalesced. */
function refresh($: Api): Promise<void> {
  dirty = true
  if (running) return running
  running = (async () => {
    try {
      while (dirty) {
        dirty = false
        try {
          const wait = lastRun + MIN_INTERVAL_MS - Date.now()
          if (wait > 0) await $.clock.sleep(wait)
          lastRun = Date.now()
          await refreshOnce($)
        } catch (err) {
          const message = String(err instanceof Error ? err.message : err)
          const problem = /jq/.test(message) ? 'jq' : message
          // Started without awaiting (void refresh): nothing may escape from here.
          await publish($, { ...EMPTY, problem }).catch(() => undefined)
        }
      }
    } finally {
      running = undefined
    }
  })()
  return running
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const lang = await initialLang($)
    await update($, langAtom, () => lang)
    await $.command.register({ name: 'cache', description: TEXTS[lang].commandDescription })
    void refresh($)
    return started
  })

  on('command.run', { command: 'cache' }, async $ => {
    const lang = await read($, langAtom)
    if (await isPopupShown($)) {
      await closePopup($)
      return { text: TEXTS[lang].closed }
    }
    await openPopup($, lang)
    return { text: TEXTS[lang].opened }
  })

  // After each tool call (a model response was just written) and at the end of each
  // turn, the main agent's as well as the subagents'.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
  }).catch(($, e, next) => next(e)) // a failure of this mod must never block a tool

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refresh($)
    return done
  })

  // A close by the person (Escape, the cross): the band says « details » again.
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await update($, popupOpen, () => false)
    return closed
  })

  // The line above the prompt: a click (or Enter while it has the focus) opens or closes the popup.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.plugin !== $.plugin.name || e.props.hasSurvey) return next(e)
    const s = await read($, statsAtom)
    if (s.problem || s.ownCount === 0) return next(e)
    const { Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, popupOpen)
    const lang = await read($, langAtom)
    const t = TEXTS[lang]
    const all = overall(s)
    // Decided from what is drawn, with no await before the open (see openPopup).
    const press = () => void (isOpen ? closePopup($) : openPopup($, lang))
    return (
      <Button key="cache-hit" plain onPress={press}>
        <Text dimColor>cache </Text>
        <Text color={tone(all)}>{`${pct(all)}%`}</Text>
        <Text> </Text>
        {s.recent.slice(-BAND_DOTS).map(c => (
          <Text color={tone(c)}>●</Text>
        ))}
        <Text dimColor>{` · ${isOpen ? t.hide : t.details}`}</Text>
      </Button>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, statsAtom)
    const lang = await read($, langAtom)
    const t = TEXTS[lang]

    // `l` switches the language: kept for the next sessions, the popup retitled.
    const switchLang = async () => {
      const next = otherLang(lang)
      await update($, langAtom, () => next)
      await $.store.set('lang', next).catch(() => undefined)
      await $.ui.open({ id: PANE, title: TEXTS[next].title, closeOnEscape: true, columns: DOCK_COLUMNS })
    }
    const buttons = (
      <Box flexDirection="row" gap={2}>
        <Button role="dismiss" hotkey="q" onPress={() => void closePopup($)}>
          {t.close}
        </Button>
        <Button key="lang" hotkey="l" onPress={() => void switchLang()}>
          {t.switchTo}
        </Button>
      </Box>
    )

    if (s.problem)
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{problemText(t, s.problem)}</Text>
          {buttons}
        </Box>
      )
    if (s.ownCount === 0)
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>{t.waiting}</Text>
          {buttons}
        </Box>
      )

    const columns = e.props.bodyColumns ?? BAR_MAX
    const width = Math.max(10, Math.min(BAR_MAX, columns))
    // Narrow (the docked pane): short labels, a compact legend and total.
    const isNarrow = width < BAR_MAX
    const fits = (label: string, short: string) => (label.length <= width - 5 ? label : short)

    // Per session: « Label        74% », the bar ━━━━━━──── colored by the thresholds,
    // then one dot per recent request, as wide as the bar.
    const session = (label: string, value: Call, recent: readonly Call[]) => {
      const p = pct(value)
      const color = tone(value)
      const filled = Math.round((p / 100) * width)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text bold>{label.padEnd(width - 4)}</Text>
            <Text color={color} bold>{`${String(p).padStart(3)}%`}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={color}>{'━'.repeat(filled)}</Text>
            <Text color="inactive">{'─'.repeat(width - filled)}</Text>
          </Box>
          <Box flexDirection="row">
            {recent.slice(-width).map(c => (
              <Text color={tone(c)}>●</Text>
            ))}
          </Box>
        </Box>
      )
    }
    const all = overall(s)

    return (
      <Box flexDirection="column" gap={1}>
        {session(fits(t.main(s.ownCount), t.mainShort), s.own, s.recent)}
        {s.subCount > 0 ? (
          session(fits(t.subs(s.subCount), t.subsShort), s.subs, s.subRecent)
        ) : (
          <Text dimColor>{t.noSubs}</Text>
        )}
        <Box flexDirection="column">
          {isNarrow ? (
            <Box flexDirection="row">
              <Text color="success">●</Text>
              <Text dimColor>{` ≥${GOOD}% `}</Text>
              <Text color="warning">●</Text>
              <Text dimColor>{` ${MID}–${GOOD}% `}</Text>
              <Text color="error">●</Text>
              <Text dimColor>{` <${MID}%`}</Text>
            </Box>
          ) : (
            <Box flexDirection="row">
              <Text color="success">●</Text>
              <Text dimColor>{` ≥ ${GOOD}%  `}</Text>
              <Text color="warning">●</Text>
              <Text dimColor>{` ${MID}–${GOOD}%  `}</Text>
              <Text color="error">●</Text>
              <Text dimColor>{` < ${MID}% (${t.lost})`}</Text>
            </Box>
          )}
          <Text dimColor>
            {(isNarrow ? t.totalShort : t.total)(pct(all), k(all.read), k(all.total))}
          </Text>
        </Box>
        {buttons}
      </Box>
    )
  })
}
