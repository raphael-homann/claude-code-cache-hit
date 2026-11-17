// Affiche la part des tokens d'entrée relus depuis le cache pour la session ouverte,
// à la manière de opencode-cache-hit : une ligne cliquable au-dessus du prompt
// (« cache 93% ●●●● ») qui ouvre une popup « Cache réutilisé ».
// Source : les transcripts JSONL de la session (principal + subagents/agent-*.jsonl),
// lus par morceaux par hooks/scan.sh (jq) pour tenir sur des fichiers de 100 Mo et plus.
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Api, Register } from 'claude-code'

import type { Call, Stats } from '../types'
import { absorb, EMPTY, GOOD, k, MID, overall, pct, projectDirName, stats, tone } from './calc'
import type { FileScan } from './calc'

const PANE = 'cache-hit'
const TITLE = 'Cache réutilisé'
const MIN_INTERVAL_MS = 1000
/** Points affichés dans la ligne au-dessus du prompt. */
const BAND_DOTS = 12
/** Largeur maximale des barres de la popup. */
const BAR_MAX = 40

const statsAtom = atom({ plugin: 'cache-hit', key: 'stats' } as const, EMPTY, { shape: 'stats-2' })
/** La popup est-elle ouverte : la ligne au-dessus du prompt dit « détails » ou « fermer ». */
const popupOpen = atom({ plugin: 'cache-hit', key: 'popupOpen' } as const, false, { shape: 'open-1' })

// Ce qui suit repart de zéro à chaque rechargement du module : on relit alors tout.
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

/** Le transcript de la session : d'abord là où Claude Code le range, sinon on le cherche. */
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

async function scanFile($: Api, path: string, scan: FileScan): Promise<FileScan> {
  const { exitCode, stdout, stderr } = await $.process.run(
    ['sh', `${$.plugin.root}/hooks/scan.sh`, path, String(scan.from)],
    { timeoutMs: 60_000 },
  )
  if (exitCode !== 0) throw new Error(stderr.trim() || `scan.sh: code ${exitCode}`)
  return absorb(scan, stdout)
}

async function refreshOnce($: Api) {
  const id = await $.session.id()
  if (id !== sessionId) {
    // Nouvelle session (démarrage, /clear, reprise) : on repart de zéro.
    sessionId = id
    mainPath = undefined
    mainScan = undefined
    subScans.clear()
  }
  mainPath ??= await findTranscript($, id)
  if (!mainPath) {
    await publish($, { ...EMPTY, problem: 'transcript introuvable (pas encore de réponse ?)' })
    return
  }

  mainScan = await scanFile($, mainPath, mainScan ?? fresh())

  const subDir = `${mainPath.replace(/\.jsonl$/, '')}/subagents`
  const entries = await $.fs.list(subDir).catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/^agent-.*\.jsonl$/.test(entry.name)) continue
    const path = `${subDir}/${entry.name}`
    subScans.set(path, await scanFile($, path, subScans.get(path) ?? fresh()))
  }

  await publish($, stats(mainScan, [...subScans.values()]))
}

async function publish($: Api, next: Stats) {
  await update($, statsAtom, () => next)
  // La v0.1 écrivait « cache N% » dans la ligne de statut, qui survit au rechargement :
  // la ligne cliquable au-dessus du prompt la remplace.
  $.ui.status(undefined)
}

/** La popup : un panneau qui prend le clavier et se ferme avec Échap. */
const openPopup = ($: Api) => {
  void refresh($)
  return $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
}

/** Ouvre la popup, ou la referme si elle est déjà ouverte. Rend true si elle est ouverte. */
async function togglePopup($: Api) {
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  await openPopup($)
  return true
}

/** Relit les transcripts ; les demandes faites pendant une lecture sont regroupées. */
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
          const problem = /jq/.test(message) ? 'jq est nécessaire (apt install jq / brew install jq)' : message
          // Lancée sans attendre (void refresh) : rien ne doit remonter d'ici.
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
    await $.command.register({
      name: 'cache',
      description: 'Afficher ou masquer la popup « Cache réutilisé »',
    })
    void refresh($)
    return started
  })

  on('command.run', { command: 'cache' }, async $ =>
    (await togglePopup($))
      ? { text: 'Popup « Cache réutilisé » ouverte (Échap pour fermer).' }
      : { text: 'Popup « Cache réutilisé » fermée.' },
  )

  // Après chaque appel d'outil (une réponse du modèle vient d'être écrite) et en fin de tour,
  // de l'agent principal comme des sous-agents.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    void refresh($)
    return ran
  }).catch(($, e, next) => next(e)) // un échec du mod ne doit jamais bloquer un outil

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    void refresh($)
    return done
  })

  // Suit l'ouverture et la fermeture de la popup, Échap et croix comprises.
  on('ui.open', async ($, e, next) => {
    const opened = await next(e)
    if (e.id === PANE && opened.value?.isPlaced) await update($, popupOpen, () => true)
    return opened
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) await update($, popupOpen, () => false)
    return closed
  })

  // La ligne au-dessus du prompt : un clic (ou Entrée quand elle a le focus) ouvre la popup.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.plugin !== $.plugin.name || e.props.hasSurvey) return next(e)
    const s = await read($, statsAtom)
    if (s.problem || s.ownCount === 0) return next(e)
    const { Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, popupOpen)
    const all = overall(s)
    return (
      <Button key="cache-hit" plain onPress={() => void togglePopup($)}>
        <Text dimColor>cache </Text>
        <Text color={tone(all)}>{`${pct(all)}%`}</Text>
        <Text> </Text>
        {s.recent.slice(-BAND_DOTS).map(c => (
          <Text color={tone(c)}>●</Text>
        ))}
        <Text dimColor>{isOpen ? ' · fermer' : ' · détails'}</Text>
      </Button>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = await read($, statsAtom)
    const close = <Button role="dismiss" hotkey="q" onPress={() => void $.ui.close({ id: PANE })}>Fermer</Button>

    if (s.problem) return <Box flexDirection="column" gap={1}><Text dimColor>{s.problem}</Text>{close}</Box>
    if (s.ownCount === 0)
      return <Box flexDirection="column" gap={1}><Text dimColor>En attente d'une première réponse…</Text>{close}</Box>

    const columns = e.props.bodyColumns ?? 40
    const width = Math.max(10, Math.min(BAR_MAX, columns - 2))

    // Par session : « Libellé        74% », la barre ━━━━━━──── colorée selon les seuils,
    // puis un point par requête récente, sur la largeur de la barre.
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
        {session(`Session principale (${s.ownCount})`, s.own, s.recent)}
        {s.subCount > 0
          ? session(`Sous-agents (${s.subCount})`, s.subs, s.subRecent)
          : <Text dimColor>Sous-agents : aucun dans cette session</Text>}
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Text color="success">●</Text>
            <Text dimColor>{` ≥ ${GOOD}%  `}</Text>
            <Text color="warning">●</Text>
            <Text dimColor>{` ${MID}–${GOOD}%  `}</Text>
            <Text color="error">●</Text>
            <Text dimColor>{` < ${MID}% (cache perdu)`}</Text>
          </Box>
          <Text dimColor>{`Total ${pct(all)}% · ${k(all.read)} sur ${k(all.total)} tokens relus`}</Text>
        </Box>
        {close}
      </Box>
    )
  })
}
